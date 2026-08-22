// ============ 抓取引擎（登录 / 导航 / 成绩 / 课表） ============
// 一份代码，四端复用：APK WebView、浏览器(经 Node 后端)、Node 后端、CLI。
// 通过 createScraper({ parse, fetchImpl, onResponse }) 注入环境相关部分：
//   - parse:       (html) => DOM Document。浏览器用 DOMParser，Node 用 linkedom。
//   - fetchImpl:   (method, url, opts) => { status, url, text() }。浏览器用全局 fetch
//                  （APK 里已被 Capacitor patch 走 OkHttp、自动 cookie jar、绕过 CORS），
//                  Node 用 undici fetch（已允许 WebVPN TLS 降级）。
//   - onResponse:  (resp, url) => void。APK 在每次非登录页请求后持久化 cookie；其它端为 null。
//
// ✅ 引擎只关心「怎么抓到数据」，不关心 UI、不关心是否登录态校验（由上层定义）。

import {
  USER_AGENT, REQUEST_TIMEOUT, MAX_RETRIES, FETCH_REFETCH_DELAY,
  WEBVPN_BASE, CAS_LOGIN_URL, NAV_URLS, GRADE_QUERY_URL, GRADE_LIST_URL,
  SCHEDULE_URL, KKSJ_FIELD, INTERNAL_HOST_MAP,
} from '../config.js';
import {
  encryptPassword, extractLoginForm, extractQueryForm, resolveSemester,
  parseGpaInfo, parseGrades, selectColumns, parseSchedule,
} from './parser.js';

/** 业务异常：登录失败、会话过期、页面结构变化等。由上层(后端/CLI/UI)捕获转成 {error}。 */
export class ScraperError extends Error {
  constructor(message) { super(message); this.name = 'ScraperError'; }
}

/** 检测 HTML 是否为 CAS 登录页（cookie 失效时 WebVPN 可能返回登录页但 URL 不变）。 */
function isLoginPage(html) {
  if (!html) return false;
  return html.includes('id="pwdFromId"') ||
         html.includes('authserver/login') ||
         html.includes('pwdEncryptSalt');
}

/**
 * 只重写主 URL 的 host，不重写 service 参数（CAS 签发的 ticket 绑定该内网 URL，必须原样）。
 * @param {string} internalUrl 内网 URL，如 https://jwxt.hhu.edu.cn/jsxsd/...
 */
function rewriteToWebvpnUrl(internalUrl) {
  let parsed;
  try { parsed = new URL(internalUrl); } catch { return internalUrl; }
  if (parsed.hostname === 'webvpn.hhu.edu.cn') return internalUrl;
  const encodedHost = INTERNAL_HOST_MAP[parsed.hostname];
  if (!encodedHost) return internalUrl;  // 未知 host，无法重写
  let base = `${WEBVPN_BASE}/https/${encodedHost}${parsed.pathname}`;
  if (parsed.search) base += parsed.search;  // 保留原始 query
  return base;
}

export function createScraper({ parse, fetchImpl, onResponse = null }) {
  const _parse = parse;

  /**
   * 带重试的请求。fetchImpl 契约：返回已读取的 { status, url, text(字符串) }。
   * 网络错误按指数退避重试 MAX_RETRIES 次，最后抛 ScraperError。
   */
  async function request(method, url, { headers = {}, params = {}, data = null } = {}) {
    const fullUrl = buildUrl(url, params);
    const merged = { 'User-Agent': USER_AGENT, ...headers };
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const opts = {
        method, headers: merged,
        credentials: 'include', redirect: 'follow',
      };
      if (data) {
        opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/x-www-form-urlencoded';
        opts.body = typeof data === 'string' ? data : encodeFormData(data);
      }
      try {
        const resp = await withTimeout(fetchImpl(method, fullUrl, opts), REQUEST_TIMEOUT);
        if (!resp || typeof resp.text !== 'string') throw new Error('fetch 返回异常');
        // 非登录页请求成功后，通知上层（APK 借此持久化 cookie）
        const isLogin = isLoginPage(resp.text) || (resp.url || '').includes('authserver/login');
        if (!isLogin && onResponse) onResponse(resp.text, resp.url);
        return resp;
      } catch (e) {
        console.warn(`[网络重试 ${attempt}/${MAX_RETRIES}] ${e.message || e}`);
        if (attempt === MAX_RETRIES) {
          throw new ScraperError(`请求失败，已重试 ${MAX_RETRIES} 次: ${url}\n最后错误: ${e.message || e}`);
        }
        await sleep(FETCH_REFETCH_DELAY * 2 ** (attempt - 1));  // 指数退避
      }
    }
  }

  const extractJsRedirect = (html) => {
    if (!html) return null;
    const m = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  };

  async function followJsRedirect(resp, maxDepth = 5) {
    for (let i = 0; i < maxDepth; i++) {
      const redirectUrl = extractJsRedirect(resp.text);
      if (!redirectUrl) break;
      const webvpnUrl = rewriteToWebvpnUrl(redirectUrl);
      if (webvpnUrl === redirectUrl) break;  // 未知 host 无法重写
      resp = await request('GET', webvpnUrl);
    }
    return resp;
  }

  async function casLogin(username, password) {
    let resp = await request('GET', CAS_LOGIN_URL);
    if (resp.status !== 200) throw new ScraperError(`获取登录页失败，状态码 ${resp.status}`);

    const { fields, captchaRequired } = extractLoginForm(resp.text, _parse);
    if (captchaRequired) {
      throw new ScraperError('登录页要求输入验证码，自动登录不可用。请改用 Cookie 回退方案（CLI 模式）。');
    }
    if (!fields.pwdEncryptSalt) {
      throw new ScraperError('未能从登录页提取 pwdEncryptSalt，页面结构可能已变化。');
    }

    const encryptedPwd = await encryptPassword(password, fields.pwdEncryptSalt);
    const form = {
      username, password: encryptedPwd,
      _eventId: fields._eventId, cllt: fields.cllt, dllt: fields.dllt,
      lt: fields.lt, pwdEncryptSalt: fields.pwdEncryptSalt, execution: fields.execution,
    };
    const post = await request('POST', CAS_LOGIN_URL, {
      headers: { Referer: CAS_LOGIN_URL, 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form,
    });
    const finalUrl = post.url;
    if (finalUrl.includes('authserver/login')) {
      if (finalUrl.includes('errorCode=')) {
        throw new ScraperError('CAS 登录失败：用户名或密码错误，或被风控拦截。');
      }
      if (post.text.includes('用户名或密码不正确')) {
        throw new ScraperError('CAS 登录失败：用户名或密码不正确。');
      }
      throw new ScraperError(`CAS 登录失败：仍停留在登录页 (${finalUrl})`);
    }
  }

  async function navigate() {
    for (let i = 0; i < NAV_URLS.length; i++) {
      let resp = await request('GET', NAV_URLS[i]);
      resp = await followJsRedirect(resp);
      if (resp.status !== 200) console.warn(`[警告] 第 ${i + 1}/${NAV_URLS.length} 步状态码 ${resp.status}`);
      if ((resp.url || '').includes('authserver/login')) {
        throw new ScraperError(`第 ${i + 1} 步被重定向回 CAS 登录页，会话可能已过期: ${resp.url}`);
      }
    }
  }

  async function queryGrades(semester = null) {
    let resp = await request('GET', GRADE_QUERY_URL);
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。');
    }
    const { semesterOptions } = extractQueryForm(resp.text, _parse);

    if (semester && semesterOptions.length) {
      const value = resolveSemester(semester, semesterOptions);
      if (value === null) {
        const available = semesterOptions.slice(0, 20).map((o) => `${o.text}(value=${JSON.stringify(o.value)})`).join('; ');
        throw new ScraperError(`未找到匹配学期: ${semester}\n可选(前20): ${available}`);
      }
      resp = await request('GET', GRADE_LIST_URL, {
        params: { [KKSJ_FIELD]: value }, headers: { Referer: GRADE_QUERY_URL },
      });
    } else {
      resp = await request('GET', GRADE_LIST_URL);
    }
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。');
    }
    return resp.text;
  }

  async function getSemesters() {
    let resp = await request('GET', GRADE_QUERY_URL);
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。');
    }
    const { fields, semesterOptions } = extractQueryForm(resp.text, _parse);
    return {
      semesters: semesterOptions.map((o) => ({ value: o.value, text: o.text })),
      defaultSemester: fields[KKSJ_FIELD] || '',
    };
  }

  async function querySchedule(semester = null, week = null) {
    let resp;
    if (semester || week) {
      resp = await request('POST', SCHEDULE_URL, {
        headers: { Referer: SCHEDULE_URL },
        data: { cj0701id: '', xnxq01id: semester || '', zc: week ? String(week) : '' },
      });
    } else {
      resp = await request('GET', SCHEDULE_URL);
    }
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。');
    }
    return resp.text;
  }

  return {
    ScraperError, casLogin, navigate, getSemesters, queryGrades, querySchedule,
    // 暴露解析函数（平台层可直接用），已绑定当前注入的 parse
    parseGpaInfo: (html) => parseGpaInfo(html),
    parseGrades: (html) => parseGrades(html, _parse),
    selectColumns,
    parseSchedule: (html) => parseSchedule(html, _parse),
    // 测试用
    _buildUrl: buildUrl,
    _rewriteToWebvpnUrl: rewriteToWebvpnUrl,
  };
}

// ---- 工具 ----
function buildUrl(url, params) {
  if (!params || Object.keys(params).length === 0) return url;
  const qs = encodeFormData(params);
  return url + (url.includes('?') ? '&' : '?') + qs;
}
function encodeFormData(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`请求超时(${ms}ms)`)), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
