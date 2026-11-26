// ============ Node 环境接线（Web 模式后端 / CLI 复用同一份引擎） ============
// 在 Node 里把「DOM 解析器(linkedom) + 带完整 CookieJar 与手动重定向跟踪的 HTTP 传输」注入引擎。
//
// 关键修复：原生 fetch(redirect:'follow') 会吞掉中间 302 响应的 Set-Cookie（例如 CAS 登录跳转
// 链上的 CASTGC / wengine_vpn_ticket）。这里改用 redirect:'manual' 逐跳处理，确保每一跳的
// Set-Cookie 按域名与路径完整写入 CookieJar，同时支持 stopOnTicket 捕获 zhjc CAS 票据。

import { parseHTML } from 'linkedom';
import { createScraper } from '../web/js/engine/scraper.js';
import { CookieJar } from './cookie-jar.js';

const MAX_REDIRECTS = 15;

/** 合并显式传入的 Cookie 头与 jar 里的 Cookie（显式传入优先，如 zhjc 的 tenantId=1）。 */
function mergeCookieHeader(explicitCookie, jarCookie) {
  if (!explicitCookie) return jarCookie;
  if (!jarCookie) return explicitCookie;
  const map = new Map();
  for (const part of jarCookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  for (const part of explicitCookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return Array.from(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 构造带 CookieJar + 手动重定向跟踪的 fetch 实现。
 * @param {CookieJar} jar 域/路径感知的 CookieJar
 */
export function makeNodeFetch(jar) {
  return async (method, url, opts = {}) => {
    let currentMethod = (method || 'GET').toUpperCase();
    let currentUrl = url;
    let currentBody = opts.body;
    const baseHeaders = { ...(opts.headers || {}) };
    const redirectHistory = [];

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers = { ...baseHeaders };
      // 重定向后切为 GET 时清除 Content-Type
      if (hop > 0 && currentMethod === 'GET') {
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
      const explicitCookie = headers.Cookie || headers.cookie || '';
      delete headers.cookie;
      const mergedCookie = mergeCookieHeader(explicitCookie, jar.getCookieHeader(currentUrl));
      if (mergedCookie) headers.Cookie = mergedCookie;
      else delete headers.Cookie;

      const resp = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
        redirect: 'manual',
      });

      // 每一跳都立刻保存 Set-Cookie（含 302 中间响应）
      const setCookies = resp.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) jar.setFromHeader(sc, currentUrl);

      const isRedirect = resp.status >= 300 && resp.status < 400;
      const location = resp.headers.get('location');
      if (isRedirect && location && opts.redirect !== 'manual') {
        const nextUrl = new URL(location, currentUrl).toString();
        redirectHistory.push(nextUrl);

        // 若调用方要求捕获 CAS ticket，命中即停止跟随
        if (opts.stopOnTicket && /[?&]ticket=/.test(nextUrl)) {
          await resp.arrayBuffer().catch(() => {});
          return { status: resp.status, url: nextUrl, text: '', redirectHistory };
        }

        // 释放当前响应体，继续下一跳
        await resp.arrayBuffer().catch(() => {});
        if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        currentUrl = nextUrl;
        continue;
      }

      if (opts.responseType === 'bytes') {
        const ab = await resp.arrayBuffer();
        return { status: resp.status, url: resp.url || currentUrl, text: '', bytes: new Uint8Array(ab), redirectHistory };
      }
      const text = await resp.text();
      return { status: resp.status, url: resp.url || currentUrl, text, redirectHistory };
    }

    throw new Error(`重定向次数超过上限 (${MAX_REDIRECTS}): ${currentUrl}`);
  };
}

/** 创建引擎实例与对应 CookieJar（跨请求保持同一会话）。 */
export function makeScraper(jar = new CookieJar()) {
  const parse = (html) => parseHTML(html).document;
  const scraper = createScraper({ parse, fetchImpl: makeNodeFetch(jar) });
  scraper.jar = jar;
  return scraper;
}

export { CookieJar };
