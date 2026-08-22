// ============ Node 环境接线（Web 模式后端 / CLI 复用同一份引擎） ============
// 在 Node 里把「DOM 解析器 + HTTP 传输」注入给引擎，其余逻辑与 APK 完全一致。
//   - DOM：linkedom（与浏览器 DOMParser 行为对齐）
//   - HTTP：全局 fetch + 会话 cookie jar（Node 无自动 cookie 管理）
// WebVPN 证书当前受信任（已实测），因此使用默认 TLS 校验。

import { parseHTML } from 'linkedom';
import { createScraper } from '../web/js/engine/scraper.js';

/**
 * 构造一个带 cookie jar 的 fetch（对应浏览器里由 cookie jar 自动管理的请求）。
 * @param {Map<string,string>} jar 会话 cookie：name -> value，跨请求共享。
 */
function makeNodeFetch(jar) {
  return async (method, url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    const cookie = Array.from(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;

    const resp = await fetch(url, {
      method, headers, body: opts.body, redirect: 'follow',
    });
    const text = await resp.text();

    // 解析 Set-Cookie 存入 jar（Node 支持 resp.headers.getSetCookie()）
    for (const sc of (resp.headers.getSetCookie?.() ?? [])) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // Max-Age=0 或空值表示删除该 cookie
      const maxAge = /max-age=0/i.test(sc);
      if (maxAge || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return { status: resp.status, url: resp.url || url, text };
  };
}

/** 创建一份引擎实例（绑定到给定 cookie jar，跨请求保持同一会话）。 */
export function makeScraper(jar = new Map()) {
  const parse = (html) => parseHTML(html).document;
  return createScraper({ parse, fetchImpl: makeNodeFetch(jar) });
}
