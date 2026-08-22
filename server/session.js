// ============ 会话存储（内存 + TTL） ============
// Web 模式后端：每个登录会保持一个刮取器实例（内含 cookie jar），供后续 /query 复用。
// 默认内存实现，重启即清空；如需持久化可替换为文件 / Redis 的同类接口。

import { SESSION_TTL_MS } from '../web/js/config.js';

const SESSIONS = new Map();   // sid -> { scraper, createdAt }
const SESSION_TTL_MS_ = SESSION_TTL_MS;

/** 生成一个会话 id 并登记刮取器。 */
export function createSession(scraper) {
  const sid = crypto.randomUUID();
  SESSIONS.set(sid, { scraper, createdAt: Date.now() });
  return sid;
}

/** 取会话对应的刮取器；不存在或已过期返回 null。 */
export function getSession(sid) {
  const entry = SESSIONS.get(sid);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS_) {
    SESSIONS.delete(sid);
    return null;
  }
  return entry.scraper;
}

/** 销毁会话。 */
export function destroySession(sid) {
  SESSIONS.delete(sid);
}

/** 当前会话数（健康检查用）。 */
export function sessionCount() {
  return SESSIONS.size;
}
