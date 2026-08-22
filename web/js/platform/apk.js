// ============ APK 模式 Backend（离线，无服务器） ============
// 直接用抓取引擎在 WebView 里完成 CAS 登录 + 查询，全部离线。
// 依赖 Capacitor 原生桥：
//   - CapacitorHttp.enabled=true 后全局 fetch 走 native OkHttp（自动 cookie jar、绕过 CORS、跟随 3xx）
//   - window.Capacitor.Plugins 提供 CapacitorCookies / InAppBrowser
//   - 自研 `window.HHUCookieHelper.getCookiesForUrl(url)` 读取任意域 cookie（见 MainActivity.java）
//   - `window.CapacitorCookiesAndroidInterface.setCookie(url, setCookie)` 写回 persistent cookie

import { CLASSROOM_URL, ORLAN_URL } from '../config.js';
import { createScraper } from '../engine/scraper.js';
import { store } from '../store.js';

function cap() { return window.Capacitor; }
function isNative() { return !!cap()?.isNativePlatform?.(); }
function plugin(name) { return cap()?.Plugins?.[name]; }

// ---- 原生 fetch（Capacitor patch 过后） ----
// 契约：返回 { status, url, text }，body 只读一次
async function nativeFetch(method, url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  return { status: resp.status, url: resp.url || url, text };
}

// ---- cookie 持久化：登录后/每次请求后/InAppBrowser 导航后写回 localStorage ----
async function saveCookies() {
  const helper = window.HHUCookieHelper;
  if (!helper || typeof helper.getCookiesForUrl !== 'function') return;
  try {
    const cookies = {
      webvpn: helper.getCookiesForUrl('https://webvpn.hhu.edu.cn') || '',
      smst: helper.getCookiesForUrl('https://smst.hhu.edu.cn') || '',   // 奥兰系统域，含设备类型标记
    };
    store.saveSavedCookies(JSON.stringify(cookies));
  } catch (e) { console.warn('保存 cookie 失败:', e.message); }
}

/** APP 启动时调用：把持久化的 cookie 改写为 persistent cookie 写回 native store，
 *  使其绕过 CapacitorCookies.load() 的 removeSessionCookies()，从而重启免登录。 */
async function restoreCookies() {
  const data = store.loadSavedCookies();
  if (!data.cookies) return false;
  const capInterface = window.CapacitorCookiesAndroidInterface;
  if (!capInterface) return false;

  // 兼容旧格式（纯字符串）与新格式（{webvpn, smst}）
  let cookies;
  try {
    cookies = JSON.parse(data.cookies);
    if (typeof cookies === 'string') cookies = { webvpn: cookies, smst: '' };
  } catch { cookies = { webvpn: data.cookies, smst: '' }; }

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  let restored = 0;
  for (const [url, csv] of [['https://webvpn.hhu.edu.cn', cookies.webvpn], ['https://smst.hhu.edu.cn', cookies.smst]]) {
    if (!csv) continue;
    for (const pair of csv.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      try { capInterface.setCookie(url, `${trimmed}; Expires=${expires}; Path=/`); restored++; }
      catch (e) { console.warn('恢复 cookie 失败:', e.message); }
    }
  }
  return restored > 0;
}

async function clearNativeCookies() {
  try {
    if (plugin('CapacitorCookies')?.clearAllCookies) await plugin('CapacitorCookies').clearAllCookies();
  } catch { /* 忽略 */ }
  store.clearSavedCookies();
}

// ---- 抓取引擎（浏览器环境：DOMParser + Capacitor 原生 fetch + cookie 持久化钩子） ----
const Scraper = createScraper({
  parse: (html) => new DOMParser().parseFromString(html, 'text/html'),
  fetchImpl: nativeFetch,
  onResponse: () => saveCookies(),   // 每次非登录页请求后同步 cookie
});

// ---- InAppBrowser 内嵌 WebView（办事大厅 / 奥兰系统） ----
function openWebView(url, userAgent) {
  const InAppBrowser = plugin('InAppBrowser');
  if (!InAppBrowser || typeof InAppBrowser.openInWebView !== 'function') {
    throw new Error('InAppBrowser 插件未注册，请运行 npx cap sync 后重新构建 APK');
  }
  InAppBrowser.removeAllListeners();
  // isIsolated:false 使 InAppBrowser 与主 WebView 共享 CookieManager，
  // 导航完成后的 smst/webvpn cookie 才能被 saveCookies 读到
  InAppBrowser.addListener('browserPageNavigationCompleted', async () => { await saveCookies(); });
  const opening = InAppBrowser.openInWebView({
    url,
    options: {
      showURL: false, showToolbar: true,
      clearCache: false, clearSessionCache: false,      // 保留 cookie，下次免登录
      mediaPlaybackRequiresUserAction: true,
      closeButtonText: '关闭', toolbarPosition: 0,      // TOP
      showNavigationButtons: true, leftToRight: false,
      ...(userAgent ? { customWebViewUserAgent: userAgent } : {}),
      android: { allowZoom: true, hardwareBack: true, pauseMedia: true, isIsolated: false },
      iOS: { allowOverScroll: true, viewStyle: 2, allowsBackForwardNavigationGestures: true },
    },
  });
  // 导航链后期才写入的 smst 设备标记 cookie 会晚于 pageCompleted 产生，
  // 延后再存几次，确保奥兰"二次打开变桌面版"的标记 cookie 被持久化
  [800, 2500].forEach((ms) => setTimeout(() => saveCookies(), ms));
  return opening;
}

// 移动版 UA：让奥兰/办事大厅等外链返回手机版界面（而非桌面版）
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export const backend = {
  isNative: () => true,

  async login(username, password) {
    // 登录前清掉可能被污染的匿名 session cookie，避免 CAS 直接返回登录页
    await clearNativeCookies();
    await Scraper.casLogin(username, password);
    await Scraper.navigate();
    const { semesters, defaultSemester } = await Scraper.getSemesters();
    await saveCookies();
    // 伪 session_id：APK 无后端，仅用于前端状态判断
    return { sessionId: 'local_' + Date.now(), semesters: semesters || [], defaultSemester };
  },

  async query(semester) {
    const html = await Scraper.queryGrades(semester);
    const gpaInfo = Scraper.parseGpaInfo(html);
    const { headers, dataRows } = Scraper.parseGrades(html);
    const grades = Scraper.selectColumns(headers, dataRows);
    return { gpaInfo, grades };
  },

  async querySchedule(semester, week) {
    const html = await Scraper.querySchedule(semester, week);
    const schedule = Scraper.parseSchedule(html);
    return { schedule };
  },

  async logout() {
    try {
      if (plugin('CapacitorCookies')?.clearAllCookies) await plugin('CapacitorCookies').clearAllCookies();
    } catch { /* 忽略 */ }
    store.clearSavedCookies();
  },

  restoreCookies,   // 供 app.js 启动时调用
  saveCookies,

  async openClassroom() { await openWebView(CLASSROOM_URL, MOBILE_UA); },   // 办事大厅也用移动 UA
  async openOrlan() { await openWebView(ORLAN_URL, MOBILE_UA); },
};
