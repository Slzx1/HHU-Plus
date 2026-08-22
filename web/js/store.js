// ============ 本地状态持久化（localStorage） ============
// 集中管理所有需要「APP 重启后仍保留」的状态：会话、凭据、缓存、节流时间、cookie。
// Web 模式与 APK 模式共用；APK 额外用 cookie 持久化（见 platform/apk.js）。

const K = {
  SESSION: 'hhup.session',
  SEMESTERS: 'hhup.semesters',
  DEFAULT_SEM: 'hhup.default_semester',
  AUTO_LOGIN: 'hhup.auto_login',
  LAST_LOGIN: 'hhup.last_login_time',
  SCHEDULE_CACHE: 'hhup.schedule_cache',
  GRADES_CACHE: 'hhup.grades_cache',
  SAVED_COOKIES: 'hhup.saved_cookies',
  COOKIE_TIME: 'hhup.cookie_save_time',
};

const isNative = () => !!window.Capacitor?.isNativePlatform?.();

function get(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function remove(key) { localStorage.removeItem(key); }

export const store = {
  // ---- 会话 ----
  // 「是否登录过」以是否有 semesters 为准，而不是有没有 session_id。
  // APK 从不存真实 session_id（真实会话靠持久化 cookie），若以 session_id 判定，
  // 重开时 loadSession 返回 null -> 走自动登录且被节流拦下 -> 回登录页（致命）。
  loadSession() {
    const semesters = get(K.SEMESTERS, []);
    if (!semesters.length) return null;
    return { sessionId: localStorage.getItem(K.SESSION) || '', semesters, defaultSemester: localStorage.getItem(K.DEFAULT_SEM) || '' };
  },
  saveSession({ sessionId, semesters, defaultSemester }) {
    set(K.SEMESTERS, semesters);
    if (defaultSemester) localStorage.setItem(K.DEFAULT_SEM, defaultSemester);
    // APK 的 sessionId 是伪造的（真实会话靠持久化 cookie），无需也不会真正失效
    if (!isNative()) localStorage.setItem(K.SESSION, sessionId);
  },
  clearSession() {
    remove(K.SESSION); remove(K.SEMESTERS); remove(K.DEFAULT_SEM);
  },

  // ---- 自动登录凭据 ----
  loadCredentials() {
    try { return localStorage.getItem(K.AUTO_LOGIN) ? JSON.parse(localStorage.getItem(K.AUTO_LOGIN)) : null; }
    catch { return null; }
  },
  saveCredentials(username, password) { localStorage.setItem(K.AUTO_LOGIN, JSON.stringify({ username, password })); },
  clearCredentials() { remove(K.AUTO_LOGIN); },

  // ---- 登录节流（防频繁登录触发风控） ----
  getLastLoginTime() { const v = localStorage.getItem(K.LAST_LOGIN); return v ? parseInt(v, 10) : 0; },
  saveLoginTime() { localStorage.setItem(K.LAST_LOGIN, String(Date.now())); },
  clearLoginTime() { remove(K.LAST_LOGIN); },

  // ---- 数据缓存（重启后可直接展示） ----
  saveScheduleCache(s) { set(K.SCHEDULE_CACHE, s); },
  loadScheduleCache() { return get(K.SCHEDULE_CACHE, null); },
  saveGradesCache(gpaInfo, grades) { set(K.GRADES_CACHE, { gpaInfo, grades }); },
  loadGradesCache() { return get(K.GRADES_CACHE, null); },

  // ---- APK cookie 持久化 ----
  loadSavedCookies() {
    const c = localStorage.getItem(K.SAVED_COOKIES);
    const t = localStorage.getItem(K.COOKIE_TIME);
    return { cookies: c, time: t ? parseInt(t, 10) : 0 };
  },
  saveSavedCookies(cookies) {
    localStorage.setItem(K.SAVED_COOKIES, cookies);
    localStorage.setItem(K.COOKIE_TIME, String(Date.now()));
  },
  clearSavedCookies() { remove(K.SAVED_COOKIES); remove(K.COOKIE_TIME); },
};

// ---- 学期推断（当前日期 → 教务系统 kksj 值） ----
/** 河海大学校历：8-12月 秋季(1)；1-6月 春季(2)；7月 暑期(3)。 */
export function detectCurrentSemester(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 8) return `${y}-${y + 1}-1`;
  if (m >= 7) return `${y - 1}-${y}-3`;
  return `${y - 1}-${y}-2`;
}

/** 选默认学期：优先教务系统返回的默认值，否则用日期推断的当前学期，再退化为匹配同年份的末位。 */
export function pickDefaultSemester(serverDefault, list) {
  const values = new Set(list.map((s) => s.value));
  if (serverDefault && values.has(serverDefault)) return serverDefault;
  const detected = detectCurrentSemester();
  if (values.has(detected)) return detected;
  const prefix = detected.slice(0, 9);
  const matches = list.filter((s) => s.value && s.value.startsWith(prefix));
  if (matches.length) return matches[matches.length - 1].value;
  return '';
}
