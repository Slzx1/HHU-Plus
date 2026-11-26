// ============ 会话存储（内存 + 滑动 TTL + 定期清理） ============
// Web 模式后端：每个登录会话绑定一个刮取器实例（内含 CookieJar 与 zhjcToken），
// 供成绩 / 课表 / 通行码 / 办事大厅代理 / 奥兰代理全部复用，直到学校认证真正过期。

import { SESSION_TTL_MS } from '../web/js/config.js';

const SESSIONS = new Map();   // sid -> { scraper, jar, username, createdAt, lastAccessAt }

/** 生成会话 id 并登记刮取器与 CookieJar。 */
export function createSession(scraper, { username = '' } = {}) {
  const sid = crypto.randomUUID();
  const now = Date.now();
  SESSIONS.set(sid, {
    scraper,
    jar: scraper.jar,
    username,
    createdAt: now,
    lastAccessAt: now,
  });
  return sid;
}

/** 取会话完整对象；不存在或已过期返回 null，命中则刷新滑动过期时间。 */
export function getSessionEntry(sid) {
  if (!sid) return null;
  const entry = SESSIONS.get(sid);
  if (!entry) return null;
  if (Date.now() - entry.lastAccessAt > SESSION_TTL_MS) {
    SESSIONS.delete(sid);
    return null;
  }
  entry.lastAccessAt = Date.now();
  return entry;
}

/** 取会话对应的刮取器；不存在或已过期返回 null。 */
export function getSession(sid) {
  return getSessionEntry(sid)?.scraper ?? null;
}

/** 销毁会话。 */
export function destroySession(sid) {
  if (!sid) return;
  const entry = SESSIONS.get(sid);
  entry?.jar?.clear?.();
  SESSIONS.delete(sid);
}

/** 清理全部过期会话。 */
export function pruneExpiredSessions() {
  const now = Date.now();
  for (const [sid, entry] of SESSIONS.entries()) {
    if (now - entry.lastAccessAt > SESSION_TTL_MS) SESSIONS.delete(sid);
  }
}

/** 当前活跃会话数（健康检查用）。 */
export function sessionCount() {
  pruneExpiredSessions();
  return SESSIONS.size;
}

// 定期清理过期会话（unref 避免阻塞进程退出）
const cleanupTimer = setInterval(pruneExpiredSessions, 10 * 60 * 1000);
cleanupTimer.unref?.();
