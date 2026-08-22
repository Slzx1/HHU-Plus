// ============ Web 模式 Backend（浏览器 → 本地 Node 后端 /api） ============
// 统一接口：login / query / querySchedule / logout / openClassroom / openOrlan
// 浏览器有 CORS 限制，无法直接请求 WebVPN，所以一律走后端代理；
// 会话由后端内存管理（session_id），前端只持有该 id。

import { CLASSROOM_URL, ORLAN_URL } from '../config.js';

const API = '/api';
let sessionId = null;

async function api(url, body) {
  const resp = await fetch(API + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await resp.json(); }
  catch { throw new Error(`服务器返回格式错误（HTTP ${resp.status}）`); }
  if (!resp.ok || data.error) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
  return data;
}

export const backend = {
  isNative: () => false,

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

  async logout() {
    await api('/grades/logout', { session_id: sessionId }).catch(() => {});
    sessionId = null;
  },

  // 办事大厅 / 奥兰系统：浏览器的登录态若已存在则直接打开；否则会走一次 CAS。新标签页打开。
  async openClassroom() { window.open(CLASSROOM_URL, '_blank'); },
  async openOrlan() { window.open(ORLAN_URL, '_blank'); },
};
