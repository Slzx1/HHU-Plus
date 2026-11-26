// ============ APK 模式 Backend（离线，无服务器） ============
// 直接在 WebView 里运行同一份抓取引擎完成 CAS 登录 / 课表 / 成绩 / 通行码，
// 并借助自研 MainActivity Cookie 桥接（HHUCookieHelper）与 InAppBrowser 实现
// 「一次登录、全功能免重登、清后台重开仍保持登录态」。

import {
  CLASSROOM_URL, ORLAN_HOME_URL, ZHJC_CAS_URL, MOBILE_UA, APK_COOKIE_URLS,
} from '../config.js';
import { createScraper } from '../engine/scraper.js';
import { store } from '../store.js';

function cap() { return window.Capacitor; }
function plugin(name) { return cap()?.Plugins?.[name]; }

// ---- 原生 fetch（CapacitorHttp patch 后走 OkHttp，自动管理 Cookie、绕过 CORS） ----
async function nativeFetch(method, url, opts = {}) {
  const fetchOpts = {
    method: opts.method || method,
    headers: opts.headers,
    body: opts.body,
    credentials: 'include',
    redirect: 'follow',
  };
  const resp = await fetch(url, fetchOpts);
  if (opts.responseType === 'bytes') {
    const ab = await resp.arrayBuffer();
    return { status: resp.status, url: resp.url || url, text: '', bytes: new Uint8Array(ab) };
  }
  const text = await resp.text();
  return { status: resp.status, url: resp.url || url, text };
}

// ---- 多域 / 多路径 Cookie 持久化（含 CASTGC / WebVPN / JWXT / TaskCenter / SMST / ZHJC） ----
async function saveCookies() {
  const helper = window.HHUCookieHelper;
  if (!helper || typeof helper.getCookiesForUrl !== 'function') return;
  try {
    const snapshot = {};
    for (const item of APK_COOKIE_URLS) {
      snapshot[item.key] = helper.getCookiesForUrl(item.url) || '';
    }
    store.saveSavedCookies(JSON.stringify(snapshot));
    if (typeof helper.flushCookies === 'function') helper.flushCookies();
  } catch (e) { console.warn('保存 cookie 失败:', e.message); }
}

/**
 * APP 启动时恢复持久化 Cookie（写回持久化 Expires 绕过 CapacitorCookies 的 removeSessionCookies），
 * 并按原域与原路径写回后立即 flush 落盘，保证重启后课表/成绩/通行码/办事大厅/奥兰全部免重登。
 */
async function restoreCookies() {
  const savedToken = store.loadZhjcToken();
  if (savedToken) Scraper.setZhjcToken(savedToken);

  const data = store.loadSavedCookies();
  if (!data.cookies) return false;
  const helper = window.HHUCookieHelper;
  const capInterface = window.CapacitorCookiesAndroidInterface;
  const setOne = (url, value) => {
    if (helper && typeof helper.setCookie === 'function') helper.setCookie(url, value);
    else if (capInterface && typeof capInterface.setCookie === 'function') capInterface.setCookie(url, value);
  };
  if (!helper?.setCookie && !capInterface?.setCookie) return false;

  // 兼容旧格式（纯字符串或 {webvpn, smst}）与新格式（全量 APK_COOKIE_URLS）
  let snapshot;
  try {
    snapshot = JSON.parse(data.cookies);
    if (typeof snapshot === 'string') snapshot = { webvpn: snapshot };
  } catch { snapshot = { webvpn: data.cookies }; }

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  let restored = 0;
  for (const item of APK_COOKIE_URLS) {
    const csv = snapshot[item.key];
    if (!csv) continue;
    for (const pair of csv.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      try {
        setOne(item.url, `${trimmed}; Expires=${expires}; Path=${item.path}`);
        restored++;
      } catch (e) { console.warn(`恢复 ${item.key} cookie 失败:`, e.message); }
    }
  }
  if (typeof helper?.flushCookies === 'function') helper.flushCookies();
  return restored > 0;
}

async function clearNativeCookies() {
  try {
    if (plugin('CapacitorCookies')?.clearAllCookies) await plugin('CapacitorCookies').clearAllCookies();
  } catch { /* 忽略 */ }
  store.clearSavedCookies();
  store.saveZhjcToken(null);
  Scraper.setZhjcToken(null);
}

// ---- 抓取引擎（浏览器 DOMParser + Capacitor 原生 fetch + Cookie/Token 持久化钩子） ----
const Scraper = createScraper({
  parse: (html) => new DOMParser().parseFromString(html, 'text/html'),
  fetchImpl: nativeFetch,
  onResponse: () => saveCookies(),
  onZhjcToken: (token) => store.saveZhjcToken(token),
});

// ---- InAppBrowser 内嵌 WebView（办事大厅 / 奥兰系统 / 官方门禁页） ----
function openWebView(url, userAgent = MOBILE_UA) {
  const InAppBrowser = plugin('InAppBrowser');
  if (!InAppBrowser || typeof InAppBrowser.openInWebView !== 'function') {
    throw new Error('InAppBrowser 插件未注册，请运行 npx cap sync 后重新构建 APK');
  }
  InAppBrowser.removeAllListeners();
  // isIsolated:false 共享主 WebView 的 CookieManager，实现一次登录免重登
  InAppBrowser.addListener('browserPageNavigationCompleted', async () => { await saveCookies(); });
  const opening = InAppBrowser.openInWebView({
    url,
    options: {
      showURL: false,
      showToolbar: true,
      clearCache: false,
      clearSessionCache: false,
      mediaPlaybackRequiresUserAction: true,
      closeButtonText: '返回',
      toolbarPosition: 0,
      showNavigationButtons: true,
      leftToRight: false,
      ...(userAgent ? { customWebViewUserAgent: userAgent } : {}),
      android: { allowZoom: true, hardwareBack: true, pauseMedia: true, isIsolated: false },
      iOS: { allowOverScroll: true, viewStyle: 2, allowsBackForwardNavigationGestures: true },
    },
  });
  // 延迟再次保存 cookie，捕获奥兰 smst 设备标记等异步写入 cookie，避免二次打开变桌面版
  [800, 2500].forEach((ms) => setTimeout(() => saveCookies(), ms));
  return opening;
}

export const backend = {
  isNative: () => true,

  async restoreSession() {
    await restoreCookies();
    return true;
  },

  async login(username, password) {
    await clearNativeCookies();
    await Scraper.casLogin(username, password);
    await Scraper.navigate();
    const { semesters, defaultSemester } = await Scraper.getSemesters();
    await saveCookies();
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

  async queryPassCode({ refreshUser = false } = {}) {
    // 确保原生 CookieManager 对 zhjc.hhu.edu.cn 持有 tenantId=1，避免 CapacitorHttp 覆盖手动 Cookie 头
    try {
      const helper = window.HHUCookieHelper;
      const capIf = window.CapacitorCookiesAndroidInterface;
      const c = 'tenantId=1; Path=/';
      if (helper?.setCookie) helper.setCookie('https://zhjc.hhu.edu.cn/', c);
      else if (capIf?.setCookie) capIf.setCookie('https://zhjc.hhu.edu.cn/', c);
    } catch { /* 忽略 */ }
    return Scraper.queryPassCode({ refreshUser });
  },

  async logout() {
    await clearNativeCookies();
  },

  restoreCookies,
  saveCookies,

  getProxyUrl: () => null,
  async openClassroom() { await openWebView(CLASSROOM_URL, MOBILE_UA); },
  async openOrlan() {
    // 先静默完成奥兰 CAS 票据握手并落盘 cookie，再直开 ORLAN_HOME_URL 跳过 login.aspx
    try { await Scraper.ensureOrlanSession(); await saveCookies(); } catch { /* 降级仍尝试打开 */ }
    await openWebView(ORLAN_HOME_URL, MOBILE_UA);
  },
  async openPassCodeWeb() { await openWebView(ZHJC_CAS_URL, MOBILE_UA); },
};
