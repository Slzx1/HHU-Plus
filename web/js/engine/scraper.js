// ============ 抓取引擎（登录 / 导航 / 成绩 / 课表 / 智慧通行码） ============
// 一份代码，三端复用：APK WebView、Web 后端(Node)、CLI。
// 通过 createScraper({ parse, fetchImpl, onResponse, onZhjcToken }) 注入环境差异：
//   - parse:       (html) => DOM Document（浏览器 DOMParser / Node linkedom）
//   - fetchImpl:   (method, url, opts) => { status, url, text, buffer?, redirectHistory? }
//   - onResponse:  (respText, url) => void（APK 用于每次非登录页请求后持久化 cookie）
//   - onZhjcToken: (token) => void（APK 用于持久化 zhjc Bearer token）

import {
  USER_AGENT, MOBILE_UA, REQUEST_TIMEOUT, MAX_RETRIES, FETCH_REFETCH_DELAY,
  WEBVPN_BASE, CAS_LOGIN_URL, NAV_URLS, GRADE_QUERY_URL, GRADE_LIST_URL,
  SCHEDULE_URL, KKSJ_FIELD, INTERNAL_HOST_MAP,
  ORLAN_URL, ORLAN_HOME_URL,
  ZHJC_CAS_URL, ZHJC_OAUTH_TOKEN_URL, ZHJC_BASIC_AUTH,
  ZHJC_USER_INFO_URL, ZHJC_QR_CODE_URL, ZHJC_PHOTO_URL,
} from '../config.js';
import {
  encryptPassword, extractLoginForm, extractQueryForm, resolveSemester,
  parseGpaInfo, parseGrades, selectColumns, parseSchedule,
  extractCasTicket, parseZhjcQrResponse, parseZhjcUserInfo, uint8ToBase64,
} from './parser.js';

/** 业务异常：登录失败、会话过期、页面结构变化等。由上层捕获转成 {error}。 */
export class ScraperError extends Error {
  constructor(message, { code = null } = {}) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
  }
}

/** 检测 HTML 是否为 CAS 登录页（cookie 失效时 WebVPN 可能返回登录页但 URL 不变）。 */
export function isLoginPage(html) {
  if (!html) return false;
  return html.includes('id="pwdFromId"') ||
         html.includes('authserver/login') ||
         html.includes('pwdEncryptSalt');
}

/**
 * 只重写主 URL 的 host，不重写 service 参数（CAS 签发的 ticket 绑定原始内网 URL）。
 */
export function rewriteToWebvpnUrl(internalUrl) {
  let parsed;
  try { parsed = new URL(internalUrl); } catch { return internalUrl; }
  if (parsed.hostname === 'webvpn.hhu.edu.cn') return internalUrl;
  const encodedHost = INTERNAL_HOST_MAP[parsed.hostname];
  if (!encodedHost) return internalUrl;
  let base = `${WEBVPN_BASE}/https/${encodedHost}${parsed.pathname}`;
  if (parsed.search) base += parsed.search;
  return base;
}

export function createScraper({ parse, fetchImpl, onResponse = null, onZhjcToken = null }) {
  const _parse = parse;
  let zhjcToken = null;
  let cachedZhjcUser = null;

  /**
   * 带指数退避重试的请求。
   * fetchImpl 契约：返回 { status, url, text, bytes?, redirectHistory? }。
   */
  async function request(method, url, {
    headers = {}, params = {}, data = null,
    stopOnTicket = false, responseType = 'text', retry = true,
  } = {}) {
    const fullUrl = buildUrl(url, params);
    const merged = { 'User-Agent': USER_AGENT, ...headers };
    const maxAttempts = retry ? MAX_RETRIES : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const opts = {
        method,
        headers: { ...merged },
        credentials: 'include',
        redirect: 'follow',
        stopOnTicket,
        responseType,
      };
      if (data !== null && data !== undefined) {
        if (!opts.headers['Content-Type']) {
          opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        opts.body = typeof data === 'string' ? data : encodeFormData(data);
      }
      try {
        const resp = await withTimeout(fetchImpl(method, fullUrl, opts), REQUEST_TIMEOUT);
        if (!resp || (responseType === 'text' && typeof resp.text !== 'string')) {
          throw new Error('fetch 返回异常');
        }
        const isLogin = responseType === 'text' &&
          (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login'));
        if (!isLogin && onResponse) onResponse(resp.text || '', resp.url || fullUrl);
        return resp;
      } catch (e) {
        if (e instanceof ScraperError) throw e;
        console.warn(`[网络重试 ${attempt}/${maxAttempts}] ${e.message || e}`);
        if (attempt === maxAttempts) {
          throw new ScraperError(`请求失败，已重试 ${maxAttempts} 次: ${url}\n最后错误: ${e.message || e}`);
        }
        await sleep(FETCH_REFETCH_DELAY * 2 ** (attempt - 1));
      }
    }
  }

  const extractJsRedirect = (html) => {
    if (!html) return null;
    const m = html.match(/(?:window\.)?location(?:\.href\s*=\s*|\.replace\s*\(\s*)['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  };

  async function followJsRedirect(resp, maxDepth = 5) {
    for (let i = 0; i < maxDepth; i++) {
      const redirectUrl = extractJsRedirect(resp.text);
      if (!redirectUrl) break;
      const webvpnUrl = rewriteToWebvpnUrl(redirectUrl);
      if (webvpnUrl === redirectUrl) break;
      resp = await request('GET', webvpnUrl);
    }
    return resp;
  }

  // ---- CAS 登录（一次登录建立整个 WebVPN + CAS 会话） ----
  async function casLogin(username, password) {
    zhjcToken = null;
    cachedZhjcUser = null;

    const resp = await request('GET', CAS_LOGIN_URL);
    if (resp.status !== 200) throw new ScraperError(`获取登录页失败，状态码 ${resp.status}`);

    const { fields, captchaRequired } = extractLoginForm(resp.text, _parse);
    if (captchaRequired) {
      throw new ScraperError('登录页要求输入验证码，自动登录不可用。请稍后再试或使用 Cookie 回退方案。');
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
      retry: false, // 登录 POST 不自动重试，避免重复提交触发风控
    });
    const finalUrl = post.url || '';
    if (finalUrl.includes('authserver/login') || isLoginPage(post.text)) {
      if (finalUrl.includes('errorCode=') || post.text.includes('用户名或密码不正确') || post.text.includes('密码错误')) {
        throw new ScraperError('CAS 登录失败：学号或密码不正确，或账号被风控限制。');
      }
      if (post.text.includes('验证码')) {
        throw new ScraperError('CAS 登录失败：学校要求输入验证码，请稍后再试。');
      }
      throw new ScraperError(`CAS 登录失败：仍停留在登录页 (${finalUrl})`);
    }
  }

  // ---- 导航激活教务系统会话 ----
  async function navigate() {
    for (let i = 0; i < NAV_URLS.length; i++) {
      let resp = await request('GET', NAV_URLS[i]);
      resp = await followJsRedirect(resp);
      if (resp.status !== 200) console.warn(`[警告] 导航第 ${i + 1}/${NAV_URLS.length} 步状态码 ${resp.status}`);
      if ((resp.url || '').includes('authserver/login') || isLoginPage(resp.text)) {
        throw new ScraperError(`会话已过期（第 ${i + 1} 步被重定向回 CAS 登录页），请重新登录。`, { code: 'SESSION_EXPIRED' });
      }
    }
  }

  // ---- 成绩查询 ----
  async function queryGrades(semester = null) {
    let resp = await request('GET', GRADE_QUERY_URL);
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。', { code: 'SESSION_EXPIRED' });
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
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。', { code: 'SESSION_EXPIRED' });
    }
    return resp.text;
  }

  async function getSemesters() {
    let resp = await request('GET', GRADE_QUERY_URL);
    resp = await followJsRedirect(resp);
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。', { code: 'SESSION_EXPIRED' });
    }
    const { fields, semesterOptions } = extractQueryForm(resp.text, _parse);
    return {
      semesters: semesterOptions.map((o) => ({ value: o.value, text: o.text })),
      defaultSemester: fields[KKSJ_FIELD] || '',
    };
  }

  // ---- 课表查询 ----
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
      throw new ScraperError('会话已过期（被重定向回 CAS 登录页），请重新登录。', { code: 'SESSION_EXPIRED' });
    }
    return resp.text;
  }

  // ---- 智慧通行码（zhjc.hhu.edu.cn，复用已有 CAS 会话单点登录，无需重登/无需微信） ----
  function setZhjcToken(token) {
    zhjcToken = token || null;
    if (!zhjcToken) cachedZhjcUser = null;
  }

  function getZhjcToken() {
    return zhjcToken;
  }

  async function authenticateZhjc() {
    // 1. 复用已有 WebVPN CAS 会话，请求 zhjc 的 CAS Service Ticket
    const casResp = await request('GET', ZHJC_CAS_URL, {
      headers: { 'User-Agent': MOBILE_UA },
      stopOnTicket: true,
    });

    // 从最终 URL 或重定向历史中查找 ticket=ST-...
    const candidateUrls = [casResp.url, ...(casResp.redirectHistory || [])].filter(Boolean);
    let ticketInfo = null;
    for (const u of candidateUrls) {
      ticketInfo = extractCasTicket(u);
      if (ticketInfo) break;
    }

    if (!ticketInfo) {
      if (isLoginPage(casResp.text) || (casResp.url || '').includes('authserver/login')) {
        throw new ScraperError('会话已过期（CAS 单点登录已失效），请重新登录。', { code: 'SESSION_EXPIRED' });
      }
      throw new ScraperError('通行码单点登录失败：未能获取 CAS 票据（ticket）。');
    }

    // 2. 用 CAS ticket 换取 zhjc OAuth2 Bearer access_token
    const tokenUrl =
      `${ZHJC_OAUTH_TOKEN_URL}?mobile=${encodeURIComponent(`${ticketInfo.state}@${ticketInfo.ticket}`)}` +
      `&code=${encodeURIComponent(ticketInfo.ticket)}&grant_type=mobile&scope=server`;

    const tokenResp = await request('POST', tokenUrl, {
      headers: {
        'User-Agent': MOBILE_UA,
        Authorization: ZHJC_BASIC_AUTH,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'tenantId=1',
        'Tenant-ld': '1',
        'Tenant-Id': '1',
        Accept: 'application/json',
      },
      retry: false,
    });

    let tokenJson = null;
    try { tokenJson = JSON.parse(tokenResp.text); } catch { /* handled below */ }
    const accessToken = tokenJson?.access_token || tokenJson?.data?.access_token;
    if (tokenResp.status !== 200 || !accessToken) {
      throw new ScraperError(tokenJson?.msg || `通行码认证失败（HTTP ${tokenResp.status}）`);
    }

    zhjcToken = accessToken;
    onZhjcToken?.(zhjcToken);
    return zhjcToken;
  }

  async function zhjcRequest(method, url, { retryAuth = true, responseType = 'text' } = {}) {
    if (!zhjcToken) await authenticateZhjc();

    const resp = await request(method, url, {
      headers: {
        'User-Agent': MOBILE_UA,
        Authorization: `Bearer ${zhjcToken}`,
        Cookie: 'tenantId=1',
        'Tenant-ld': '1',
        'Tenant-Id': '1',
        Accept: responseType === 'bytes' ? '*/*' : 'application/json',
      },
      responseType,
    });

    // 401 / 403 / 424 表示 zhjc access_token 已过期 -> 用已有 CAS 会话静默换新 token 重试一次
    if (resp.status === 401 || resp.status === 403 || resp.status === 424) {
      zhjcToken = null;
      cachedZhjcUser = null;
      onZhjcToken?.(null);
      if (retryAuth) {
        await authenticateZhjc();
        return zhjcRequest(method, url, { retryAuth: false, responseType });
      }
      throw new ScraperError('通行码会话已过期，请重新登录。', { code: 'SESSION_EXPIRED' });
    }
    return resp;
  }

  async function zhjcJson(method, url) {
    const resp = await zhjcRequest(method, url, { retryAuth: true, responseType: 'text' });
    let json;
    try { json = JSON.parse(resp.text); }
    catch { throw new ScraperError(`通行码接口返回格式异常（HTTP ${resp.status}）`); }

    if (resp.status !== 200 || (json.code !== undefined && json.code !== 0)) {
      throw new ScraperError(json.msg || `通行码服务出错（HTTP ${resp.status}）`);
    }
    return json;
  }

  /**
   * 获取/刷新校园通行码与持卡人信息。
   * 首次自动通过现有 CAS 会话换取 zhjc token；后续复用 token，过期时自动静默刷新。
   */
  async function queryPassCode({ refreshUser = false } = {}) {
    const qrJson = await zhjcJson('POST', ZHJC_QR_CODE_URL);
    const qr = parseZhjcQrResponse(qrJson);

    let user = cachedZhjcUser;
    if (!user || refreshUser) {
      try {
        const userJson = await zhjcJson('GET', ZHJC_USER_INFO_URL);
        user = parseZhjcUserInfo(userJson);

        // 尝试加载校园证件照（失败不影响通行码展示）
        if (user.photoFileId) {
          try {
            const photoUrl = `${ZHJC_PHOTO_URL}?fileId=${encodeURIComponent(user.photoFileId)}`;
            const photoResp = await zhjcRequest('GET', photoUrl, { retryAuth: false, responseType: 'bytes' });
            if (photoResp.status === 200 && photoResp.bytes && photoResp.bytes.length > 0) {
              user.photoDataUrl = `data:image/jpeg;base64,${uint8ToBase64(photoResp.bytes)}`;
            }
          } catch { /* 头像加载失败静默降级 */ }
        }
        cachedZhjcUser = user;
      } catch (e) {
        console.warn('[通行码] 获取用户信息失败（不影响扫码）:', e.message);
        user = user || { name: '', dept: '', code: '', phone: '', photoFileId: '', id: '' };
      }
    }
    return { qr, user };
  }

  /**
   * 静默完成奥兰系统 CAS 票据握手（绕过 smst.hhu.edu.cn 握手后停留在 login.aspx 的怪癖），
   * 握手完成后直接打开 ORLAN_HOME_URL 即可直达已登录主页。
   */
  async function ensureOrlanSession() {
    const resp = await request('GET', ORLAN_URL, {
      headers: { 'User-Agent': MOBILE_UA },
      retry: false,
    });
    if (isLoginPage(resp.text) || (resp.url || '').includes('authserver/login')) {
      throw new ScraperError('会话已过期（奥兰单点登录失效），请重新登录。', { code: 'SESSION_EXPIRED' });
    }
    return ORLAN_HOME_URL;
  }

  return {
    ScraperError,
    casLogin,
    navigate,
    getSemesters,
    queryGrades,
    querySchedule,
    ensureOrlanSession,
    authenticateZhjc,
    queryPassCode,
    getZhjcToken,
    setZhjcToken,
    parseGpaInfo: (html) => parseGpaInfo(html),
    parseGrades: (html) => parseGrades(html, _parse),
    selectColumns,
    parseSchedule: (html) => parseSchedule(html, _parse),
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
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
