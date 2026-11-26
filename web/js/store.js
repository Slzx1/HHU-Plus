// ============ 本地状态持久化（localStorage） ============
// 集中管理需要跨重启保留的状态：会话、凭据、缓存、节流时间、APK Cookie、通行码 Token、主题。

const K = {
  SESSION: 'hhup.session',
  USERNAME: 'hhup.username',
  SEMESTERS: 'hhup.semesters',
  DEFAULT_SEM: 'hhup.default_semester',
  AUTO_LOGIN: 'hhup.auto_login',
  LAST_LOGIN: 'hhup.last_login_time',
  SCHEDULE_CACHE: 'hhup.schedule_cache',
  GRADES_CACHE: 'hhup.grades_cache',
  PASSCODE_USER: 'hhup.passcode_user',
  ZHJC_TOKEN: 'hhup.zhjc_token',
  SAVED_COOKIES: 'hhup.saved_cookies',
  COOKIE_TIME: 'hhup.cookie_save_time',
  THEME: 'hhup.theme',
};

const isNative = () => !!window.Capacitor?.isNativePlatform?.();

function get(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储满时静默忽略 */ }
}
function remove(key) { localStorage.removeItem(key); }

export const store = {
  // ---- 会话 ----
  // 关键约定：「是否登录过」以 semesters.length 为准，而非 sessionId：
  // APK 端真实会话靠原生持久化 Cookie，不依赖后端 sessionId。
  loadSession() {
    const semesters = get(K.SEMESTERS, []);
    if (!Array.isArray(semesters) || !semesters.length) return null;
    return {
      sessionId: localStorage.getItem(K.SESSION) || '',
      username: localStorage.getItem(K.USERNAME) || '',
      semesters,
      defaultSemester: localStorage.getItem(K.DEFAULT_SEM) || '',
    };
  },
  saveSession({ sessionId, username, semesters, defaultSemester }) {
    set(K.SEMESTERS, semesters || []);
    if (defaultSemester) localStorage.setItem(K.DEFAULT_SEM, defaultSemester);
    if (username) localStorage.setItem(K.USERNAME, username);
    if (!isNative() && sessionId) localStorage.setItem(K.SESSION, sessionId);
  },
  clearSession() {
    remove(K.SESSION);
    remove(K.SEMESTERS);
    remove(K.DEFAULT_SEM);
    remove(K.ZHJC_TOKEN);
  },

  // ---- 自动登录凭据 ----
  loadCredentials() { return get(K.AUTO_LOGIN, null); },
  saveCredentials(username, password) { set(K.AUTO_LOGIN, { username, password }); },
  clearCredentials() { remove(K.AUTO_LOGIN); },

  // ---- 登录节流（防频繁登录触发风控） ----
  getLastLoginTime() { const v = localStorage.getItem(K.LAST_LOGIN); return v ? parseInt(v, 10) : 0; },
  saveLoginTime() { localStorage.setItem(K.LAST_LOGIN, String(Date.now())); },
  clearLoginTime() { remove(K.LAST_LOGIN); },

  // ---- 数据缓存（启动即展示，弱网/离线也可查看） ----
  saveScheduleCache(schedule, meta = {}) {
    set(K.SCHEDULE_CACHE, { schedule, meta, updatedAt: Date.now() });
  },
  loadScheduleCache() {
    const raw = get(K.SCHEDULE_CACHE, null);
    if (!raw) return null;
    // 兼容旧格式（直接存 schedule 对象）
    return raw.schedule ? raw : { schedule: raw, meta: {}, updatedAt: 0 };
  },

  saveGradesCache(gpaInfo, grades, meta = {}) {
    set(K.GRADES_CACHE, { gpaInfo, grades, meta, updatedAt: Date.now() });
  },
  loadGradesCache() {
    const raw = get(K.GRADES_CACHE, null);
    if (!raw || !raw.grades) return null;
    return { gpaInfo: raw.gpaInfo || {}, grades: raw.grades, meta: raw.meta || {}, updatedAt: raw.updatedAt || 0 };
  },

  savePassCodeUser(user) { set(K.PASSCODE_USER, user); },
  loadPassCodeUser() { return get(K.PASSCODE_USER, null); },

  clearCaches() {
    remove(K.SCHEDULE_CACHE);
    remove(K.GRADES_CACHE);
    remove(K.PASSCODE_USER);
  },

  // ---- 通行码 Bearer Token（APK 离线复用，无需每次重新换票） ----
  loadZhjcToken() { return localStorage.getItem(K.ZHJC_TOKEN) || null; },
  saveZhjcToken(token) {
    if (token) localStorage.setItem(K.ZHJC_TOKEN, token);
    else remove(K.ZHJC_TOKEN);
  },

  // ---- APK Cookie 持久化 ----
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

  // ---- 主题偏好（light / dark / auto） ----
  loadTheme() { return localStorage.getItem(K.THEME) || 'auto'; },
  saveTheme(theme) { localStorage.setItem(K.THEME, theme); },

  // ---- 主动退出时清空当前账号全部数据 ----
  clearAccountOnLogout() {
    this.clearSession();
    this.clearCredentials();
    this.clearLoginTime();
    this.clearCaches();
    this.clearSavedCookies();
    remove(K.USERNAME);
  },
};

// ---- 学期推断（当前日期 → 教务系统 kksj 值） ----
/** 河海大学校历：8-12 月秋季(1)；1-6 月春季(2)；7 月暑期(3)。 */
export function detectCurrentSemester(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 8) return `${y}-${y + 1}-1`;
  if (m >= 7) return `${y - 1}-${y}-3`;
  return `${y - 1}-${y}-2`;
}

/** 选默认学期：优先教务系统返回值，其次日期推断当前学期，再退化为同年份末位。 */
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
