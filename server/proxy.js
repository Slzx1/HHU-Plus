// ============ Web 模式免重登 SSO 反向代理 ============
// 解决 Web 模式下点击「办事大厅 / 奥兰 / 官方门禁页」时浏览器无 WebVPN Cookie 而要求重新登录的问题。
// 工作原理：
//   1. 用户在 HHU+ 登录时，服务端将 session_id 写入 HttpOnly Cookie (hhup_sid)。
//   2. 访问 /proxy/open/{classroom|orlan|zhjc} 时，服务端校验会话并将请求代理到对应校内系统，
//      所有上下游请求均复用同一份服务端 CookieJar（含 CASTGC 与 WebVPN Ticket）+ MOBILE_UA。
//   3. 严格限制仅代理 *.hhu.edu.cn 域名，防止开放代理滥用。

import { Router } from 'express';
import { CLASSROOM_URL, ORLAN_HOME_URL, ZHJC_CAS_URL, MOBILE_UA } from '../web/js/config.js';
import { getSessionEntry } from './session.js';

const TARGET_URLS = {
  classroom: CLASSROOM_URL,
  orlan: ORLAN_HOME_URL,
  zhjc: ZHJC_CAS_URL,
};

export function isAllowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'hhu.edu.cn' || h.endsWith('.hhu.edu.cn');
}

export function encodeOrigin(origin) {
  return Buffer.from(origin, 'utf8').toString('base64url');
}

export function decodeOrigin(b64) {
  try {
    const origin = Buffer.from(String(b64), 'base64url').toString('utf8');
    const u = new URL(origin);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && isAllowedHost(u.hostname)) {
      return u.origin;
    }
  } catch { /* invalid */ }
  return null;
}

export function toProxyUrl(targetUrl) {
  let u;
  try { u = new URL(targetUrl); } catch { return targetUrl; }
  if (!isAllowedHost(u.hostname)) return targetUrl;
  return `/proxy/res/${encodeOrigin(u.origin)}${u.pathname}${u.search}${u.hash}`;
}

export function parseCookiesFromReq(req) {
  const header = req.headers.cookie || '';
  const map = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return map;
}

function expiredHtmlPage(reason = '当前登录认证已过期，请返回 HHU+ 重新登录。') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>会话已过期 - HHU+</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f6f8fa;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
    .box{background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:16px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 8px 24px rgba(15,23,42,.06)}
    h2{margin:0 0 8px;font-size:18px;font-weight:600}
    p{margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6}
    a{display:inline-block;background:#1167b1;color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:500}
  </style>
</head>
<body>
  <div class="box">
    <h2>认证会话已过期</h2>
    <p>${reason}</p>
    <a href="/" target="_top">返回 HHU+ 重新登录</a>
  </div>
</body>
</html>`;
}

/** 构造注入到代理 HTML 的运行时 URL 重写垫片，拦截页面内 AJAX/fetch/表单跳转以维持免登。 */
function makeRuntimeShim(origin) {
  const originB64 = encodeOrigin(origin);
  return `<script data-hhup-proxy-shim>(function(){
  var CUR_ORIGIN=${JSON.stringify(origin)};
  var CUR_B64=${JSON.stringify(originB64)};
  function b64u(s){return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
  function rewrite(u){
    if(!u||typeof u!=='string')return u;
    if(u.indexOf('/proxy/res/')===0||u.indexOf('data:')===0||u.indexOf('blob:')===0||u.indexOf('javascript:')===0||u.indexOf('#')===0)return u;
    try{
      var resolved=u.indexOf('http')===0?new URL(u):new URL(u,CUR_ORIGIN+(location.pathname.replace(/^\\/proxy\\/res\\/[^/]+/,'')));
      if(resolved.hostname==='hhu.edu.cn'||resolved.hostname.endsWith('.hhu.edu.cn')){
        return '/proxy/res/'+b64u(resolved.origin)+resolved.pathname+resolved.search+resolved.hash;
      }
    }catch(e){}
    return u;
  }
  var origFetch=window.fetch;
  if(origFetch){window.fetch=function(input,init){
    if(typeof input==='string')input=rewrite(input);
    else if(input&&typeof input.url==='string')input=new Request(rewrite(input.url),input);
    return origFetch.call(this,input,init);
  };}
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    arguments[1]=rewrite(u);
    return origOpen.apply(this,arguments);
  };
  var origWinOpen=window.open;
  window.open=function(u,n,f){return origWinOpen.call(this,rewrite(u),n,f);};
})();</script>`;
}

function rewriteHtml(html, currentOrigin) {
  const originB64 = encodeOrigin(currentOrigin);
  // 重写属性中的绝对 *.hhu.edu.cn URL 与根相对路径 /...
  let out = html.replace(
    /\b(href|src|action)\s*=\s*(["'])([^"']+)\2/gi,
    (full, attr, quote, val) => {
      const trimmed = val.trim();
      if (!trimmed || /^(data:|javascript:|mailto:|tel:|#|\/proxy\/res\/)/i.test(trimmed)) return full;
      if (/^https?:\/\//i.test(trimmed)) {
        const rewritten = toProxyUrl(trimmed);
        return rewritten !== trimmed ? `${attr}=${quote}${rewritten}${quote}` : full;
      }
      if (trimmed.startsWith('//')) {
        const rewritten = toProxyUrl('https:' + trimmed);
        return rewritten !== 'https:' + trimmed ? `${attr}=${quote}${rewritten}${quote}` : full;
      }
      if (trimmed.startsWith('/')) {
        return `${attr}=${quote}/proxy/res/${originB64}${trimmed}${quote}`;
      }
      return full;
    },
  );
  const shim = makeRuntimeShim(currentOrigin);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  } else {
    out = shim + out;
  }
  return out;
}

function rewriteCss(css, currentOrigin) {
  const originB64 = encodeOrigin(currentOrigin);
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, val) => {
    const trimmed = val.trim();
    if (!trimmed || /^(data:|\/proxy\/res\/)/i.test(trimmed)) return full;
    if (/^https?:\/\//i.test(trimmed)) {
      const rewritten = toProxyUrl(trimmed);
      return rewritten !== trimmed ? `url(${quote}${rewritten}${quote})` : full;
    }
    if (trimmed.startsWith('/')) {
      return `url(${quote}/proxy/res/${originB64}${trimmed}${quote})`;
    }
    return full;
  });
}

export function createProxyRouter() {
  const router = Router();

  // ---- 入口：/proxy/open/:target ----
  router.get('/open/:target', async (req, res) => {
    const target = req.params.target;
    const targetUrl = TARGET_URLS[target];
    if (!targetUrl) return res.status(404).send('未知目标系统');

    const cookies = parseCookiesFromReq(req);
    const sid = req.query.sid || cookies.hhup_sid;
    const entry = getSessionEntry(sid);
    if (!entry) return res.status(401).send(expiredHtmlPage());

    // 奥兰系统：先在服务端静默完成 CAS 票据握手建立 smst 会话，再直跳 default.aspx 跳过 login.aspx
    if (target === 'orlan' && entry.scraper?.ensureOrlanSession) {
      try {
        await entry.scraper.ensureOrlanSession();
      } catch (e) {
        if (e?.code === 'SESSION_EXPIRED') return res.status(401).send(expiredHtmlPage());
      }
    }

    // 写入 HttpOnly Cookie，供后续所有子资源请求自动携带会话
    res.setHeader('Set-Cookie', `hhup_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
    return res.redirect(302, toProxyUrl(targetUrl));
  });

  // ---- 透明反向代理：/proxy/res/:originB64/* ----
  router.all(/^\/res\/([A-Za-z0-9_-]+)(\/.*)?$/, async (req, res) => {
    const originB64 = req.params[0];
    const subPath = req.params[1] || '/';
    const upstreamOrigin = decodeOrigin(originB64);
    if (!upstreamOrigin) return res.status(403).send('不允许代理该域名');

    const cookies = parseCookiesFromReq(req);
    const sid = cookies.hhup_sid || req.query._hhup_sid;
    const entry = getSessionEntry(sid);
    if (!entry) return res.status(401).send(expiredHtmlPage());

    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstreamUrl = `${upstreamOrigin}${subPath}${qs}`;

    // 组装上游请求头
    const headers = {
      'User-Agent': MOBILE_UA,
      Accept: req.headers.accept || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9',
    };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['x-requested-with']) headers['X-Requested-With'] = req.headers['x-requested-with'];
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    const cookieHeader = entry.jar.getCookieHeader(upstreamUrl);
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (req.headers.referer) {
      headers.Referer = upstreamOrigin + '/';
    }

    // 读取请求体（POST/PUT/PATCH）
    let body;
    if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = Buffer.concat(chunks);
    }

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });
    } catch (err) {
      return res.status(502).send(`代理请求失败：${err.message || err}`);
    }

    // 将上游 Set-Cookie 写入该会话的 CookieJar
    for (const sc of (upstreamResp.headers.getSetCookie?.() ?? [])) {
      entry.jar.setFromHeader(sc, upstreamUrl);
    }

    // 3xx 重定向：若目标仍为 *.hhu.edu.cn 则重写继续走免登代理
    if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
      const loc = upstreamResp.headers.get('location');
      if (loc) {
        const resolved = new URL(loc, upstreamUrl).toString();
        const proxiedLoc = toProxyUrl(resolved);
        await upstreamResp.arrayBuffer().catch(() => {});
        return res.redirect(upstreamResp.status, proxiedLoc);
      }
    }

    const contentType = upstreamResp.headers.get('content-type') || 'application/octet-stream';
    res.status(upstreamResp.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');

    if (/text\/html/i.test(contentType)) {
      const html = await upstreamResp.text();
      return res.send(rewriteHtml(html, upstreamOrigin));
    }
    if (/text\/css/i.test(contentType)) {
      const css = await upstreamResp.text();
      return res.send(rewriteCss(css, upstreamOrigin));
    }

    const buf = Buffer.from(await upstreamResp.arrayBuffer());
    return res.send(buf);
  });

  return router;
}
