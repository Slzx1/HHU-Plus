// ============ 域 & 路径感知的 CookieJar ============
// 修复原 Map<name,value> 的两大问题：
//   1. 跨域名 cookie 隔离（webvpn / authserver / smst / zhjc 各自的 JSESSIONID 互不覆盖）
//   2. 路径作用域（如 /authserver 的 CASTGC 仅发送给对应路径，且高优先级路径排在前面）

export class CookieJar {
  constructor() {
    /** @type {Map<string, {name:string, value:string, domain:string, hostOnly:boolean, path:string, expiresAt:number|null, secure:boolean}>} */
    this._cookies = new Map();
  }

  _key(domain, path, name) {
    return `${domain.toLowerCase()}|${path}|${name}`;
  }

  /** 解析单条 Set-Cookie 响应头并写入 jar。 */
  setFromHeader(setCookieStr, requestUrl) {
    if (!setCookieStr || !requestUrl) return;
    let parsedUrl;
    try { parsedUrl = new URL(requestUrl); } catch { return; }

    const parts = String(setCookieStr).split(';').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;

    const eq = parts[0].indexOf('=');
    if (eq <= 0) return;
    const name = parts[0].slice(0, eq).trim();
    const value = parts[0].slice(eq + 1).trim();

    let domain = parsedUrl.hostname.toLowerCase();
    let hostOnly = true;
    let path = defaultPath(parsedUrl.pathname);
    let expiresAt = null;
    let secure = false;
    let deleted = false;

    for (let i = 1; i < parts.length; i++) {
      const idx = parts[i].indexOf('=');
      const attrName = (idx >= 0 ? parts[i].slice(0, idx) : parts[i]).trim().toLowerCase();
      const attrVal = idx >= 0 ? parts[i].slice(idx + 1).trim() : '';

      if (attrName === 'domain' && attrVal) {
        const cleaned = attrVal.replace(/^\.+/, '').toLowerCase();
        if (domainMatches(parsedUrl.hostname.toLowerCase(), cleaned)) {
          domain = cleaned;
          hostOnly = false;
        }
      } else if (attrName === 'path' && attrVal.startsWith('/')) {
        path = attrVal;
      } else if (attrName === 'max-age') {
        const sec = parseInt(attrVal, 10);
        if (!Number.isNaN(sec)) {
          if (sec <= 0) deleted = true;
          else expiresAt = Date.now() + sec * 1000;
        }
      } else if (attrName === 'expires' && attrVal) {
        const ts = Date.parse(attrVal);
        if (!Number.isNaN(ts)) {
          if (ts <= Date.now()) deleted = true;
          else if (expiresAt === null) expiresAt = ts;
        }
      } else if (attrName === 'secure') {
        secure = true;
      }
    }

    const key = this._key(domain, path, name);
    if (deleted || value === '') {
      this._cookies.delete(key);
    } else {
      this._cookies.set(key, { name, value, domain, hostOnly, path, expiresAt, secure });
    }
  }

  /** 手动注入单条 cookie（供 CLI --cookie-file 使用）。 */
  setSimple(name, value, domain = 'webvpn.hhu.edu.cn', path = '/') {
    if (!name) return;
    const d = String(domain || 'webvpn.hhu.edu.cn').replace(/^\.+/, '').toLowerCase();
    const p = path && path.startsWith('/') ? path : '/';
    const key = this._key(d, p, name);
    if (value === '' || value === null || value === undefined) {
      this._cookies.delete(key);
    } else {
      this._cookies.set(key, { name, value: String(value), domain: d, hostOnly: false, path: p, expiresAt: null, secure: false });
    }
  }

  /** 按目标 URL 匹配应发送的 Cookie 请求头字符串。 */
  getCookieHeader(requestUrl) {
    let parsedUrl;
    try { parsedUrl = new URL(requestUrl); } catch { return ''; }
    const host = parsedUrl.hostname.toLowerCase();
    const reqPath = parsedUrl.pathname || '/';
    const isHttps = parsedUrl.protocol === 'https:';
    const now = Date.now();

    const matched = [];
    for (const [key, c] of this._cookies.entries()) {
      if (c.expiresAt !== null && c.expiresAt <= now) {
        this._cookies.delete(key);
        continue;
      }
      if (c.secure && !isHttps) continue;
      if (c.hostOnly ? host !== c.domain : !domainMatches(host, c.domain)) continue;
      if (!pathMatches(reqPath, c.path)) continue;
      matched.push(c);
    }

    // RFC 6265: 路径越长越优先
    matched.sort((a, b) => b.path.length - a.path.length);
    // 同名去重（保留更精确路径的值）
    const seen = new Set();
    const pairs = [];
    for (const c of matched) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      pairs.push(`${c.name}=${c.value}`);
    }
    return pairs.join('; ');
  }

  get size() { return this._cookies.size; }
  clear() { this._cookies.clear(); }
}

function defaultPath(pathname) {
  if (!pathname || !pathname.startsWith('/')) return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function pathMatches(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true;
  if (reqPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith('/')) return true;
    if (reqPath[cookiePath.length] === '/') return true;
  }
  return false;
}
