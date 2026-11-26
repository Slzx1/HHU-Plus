// ============ Web 模式 Backend（浏览器 → Node 后端 /api + 免重登代理 /proxy） ============
// 修复原 bug：刷新页面时从 store 恢复 sessionId 并校验后端会话，不再误丢会话！
// 办事大厅 / 奥兰 / 门禁原页通过后端 /proxy/open/{target} 携带服务端 CookieJar 免重登打开。

import { CLASSROOM_URL, ORLAN_URL, ZHJC_FRONT_URL } from '../config.js';
import { store } from '../store.js';

const API = '/api';
let sessionId = null;

async function api(url, body = {}) {
  const resp = await fetch(API + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  let data;
  try { data = await resp.json(); }
  catch { throw new Error(`服务器返回格式错误（HTTP ${resp.status}）`); }
  if (!resp.ok || data.error) {
    const err = new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

export const backend = {
  isNative: () => false,

  /** 页面刷新后从 localStorage 恢复 sessionId，并向后端校验是否仍存活。 */
  async restoreSession(savedSid) {
    sessionId = savedSid || store.loadSession()?.sessionId || null;
    if (!sessionId) return false;
    try {
      await api('/session/check', { session_id: sessionId });
      return true;
    } catch {
      sessionId = null;
      return false;
    }
  },

  async login(username, password) {
    const data = await api('/grades/login', { username, password });
    sessionId = data.session_id;
    return {
      sessionId,
      semesters: data.semesters || [],
      defaultSemester: data.default_semester,
    };
  },

  async query(semester) {
    const data = await api('/grades/query', { session_id: sessionId, semester });
    return { gpaInfo: data.gpa_info || {}, grades: data.grades || { headers: [], rows: [] } };
  },

  async querySchedule(semester, week) {
    const data = await api('/schedule/query', { session_id: sessionId, semester, week });
    return { schedule: data.schedule || { sections: [], days: [], grid: [] } };
  },

  async queryPassCode({ refreshUser = false } = {}) {
    const data = await api('/passcode/query', { session_id: sessionId, refresh_user: refreshUser });
    return { qr: data.qr, user: data.user || {} };
  },

  async logout() {
    await api('/grades/logout', { session_id: sessionId }).catch(() => {});
    sessionId = null;
  },

  /** 生成免重登反向代理地址（复用后端 CookieJar，无需浏览器重新输入账密）。 */
  getProxyUrl(target) {
    if (!sessionId) return null;
    return `/proxy/open/${encodeURIComponent(target)}?sid=${encodeURIComponent(sessionId)}`;
  },

  async openClassroom() {
    const url = this.getProxyUrl('classroom') || CLASSROOM_URL;
    window.open(url, '_blank', 'noopener');
  },
  async openOrlan() {
    const url = this.getProxyUrl('orlan') || ORLAN_URL;
    window.open(url, '_blank', 'noopener');
  },
  async openPassCodeWeb() {
    const url = this.getProxyUrl('zhjc') || ZHJC_FRONT_URL;
    window.open(url, '_blank', 'noopener');
  },
};
