// ============ 应用装配器（薄编排层） ============
// 负责：平台选择、主题管理、导航栏装配、登录/会话恢复、单飞静默续期、安全登出。

import { features } from './features/index.js';
import { pickBackend } from './platform/index.js';
import { store, pickDefaultSemester } from './store.js';
import { $, esc, showToast, setLoading, showError, hideError, openModal, closeModal } from './ui.js';
import { iconSun, iconMoon, iconEye, iconEyeOff, iconLogout } from './icons.js';
import { LOGIN_THROTTLE_MS } from './config.js';

const DEFAULT_FEATURE = 'schedule';
const ui = { showToast, setLoading, showError, hideError, openModal, closeModal };

let backend = null;
let activeFeatureId = null;
let reloginPromise = null; // 单飞锁：避免并发请求同时触发多次重登

const mobileTabBtns = new Map();
const railTabBtns = new Map();
const panels = new Map();

function getCtx() {
  return { backend, store, ui, onSessionExpired };
}

// ---- 主题管理（支持跟随系统 + 手动亮/暗切换） ----
function resolveDark(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyTheme(mode) {
  const dark = resolveDark(mode);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', dark ? '#0f1722' : '#0f5fa8');
  const iconHtml = dark ? iconSun : iconMoon;
  const label = dark ? '切换到浅色模式' : '切换到深色模式';
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.innerHTML = iconHtml;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  });
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const next = isDark ? 'light' : 'dark';
  store.saveTheme(next);
  applyTheme(next);
}

// ---- 视图切换 ----
function showView(name) {
  $('login-view').classList.toggle('active', name === 'login');
  $('main-view').classList.toggle('active', name === 'main');
}

function updateUserBadge(username) {
  const badge = $('user-badge');
  if (!badge) return;
  if (username) {
    badge.textContent = username;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// ---- 由 feature 注册表动态生成双端导航（手机底部栏 + 桌面左侧栏）与面板 ----
function buildChrome() {
  const bottomNav = $('bottom-nav');
  const sideNav = $('side-nav');
  const content = $('content');

  features.forEach((f) => {
    // 手机端底部导航项
    const mBtn = document.createElement('button');
    mBtn.type = 'button';
    mBtn.className = 'tab';
    mBtn.dataset.id = f.id;
    mBtn.innerHTML = `<span class="tab-icon">${f.icon}</span><span class="tab-label">${esc(f.label)}</span>`;
    mBtn.addEventListener('click', () => activateFeature(f.id));
    bottomNav.appendChild(mBtn);
    mobileTabBtns.set(f.id, mBtn);

    // 桌面端左侧导航项
    const rBtn = document.createElement('button');
    rBtn.type = 'button';
    rBtn.className = 'rail-item';
    rBtn.dataset.id = f.id;
    rBtn.innerHTML = `<span class="rail-icon">${f.icon}</span><span class="rail-label">${esc(f.label)}</span>`;
    rBtn.addEventListener('click', () => activateFeature(f.id));
    sideNav.appendChild(rBtn);
    railTabBtns.set(f.id, rBtn);

    // 面板容器
    if (f.type === 'panel' || f.type === 'portal') {
      const panelEl = document.createElement('section');
      panelEl.className = 'panel';
      panelEl.dataset.panel = f.id;
      content.appendChild(panelEl);
      f.render({ el: panelEl, getCtx });
      panels.set(f.id, panelEl);
    }
  });
}

function setActiveIndicators(id) {
  mobileTabBtns.forEach((btn, bid) => btn.classList.toggle('active', bid === id));
  railTabBtns.forEach((btn, bid) => btn.classList.toggle('active', bid === id));
}

function activateFeature(id) {
  const f = features.find((x) => x.id === id);
  if (!f) return;

  const result = f.onActivate?.(getCtx());
  // APK 打开原生 InAppBrowser 时返回 { keepPanel: true }，不破坏底层已选中的面板与导航高亮
  if (result && result.keepPanel) return;

  if (activeFeatureId && activeFeatureId !== id) {
    const prev = features.find((x) => x.id === activeFeatureId);
    prev?.onDeactivate?.();
  }
  activeFeatureId = id;
  setActiveIndicators(id);
  panels.forEach((el, pid) => el.classList.toggle('active', pid === id));

  const titleEl = $('navbar-title');
  if (titleEl) titleEl.textContent = f.title || f.label || 'HHU+';
}

// ---- 会话过期处理：单飞锁 + 静默续期（遵守 30 分钟节流防风控） ----
async function onSessionExpired() {
  if (reloginPromise) return reloginPromise;

  reloginPromise = (async () => {
    const saved = store.loadCredentials();
    const last = store.getLastLoginTime();
    const throttled = last > 0 && (Date.now() - last) < LOGIN_THROTTLE_MS;

    // 优先静默续期：有已存凭据且未触达节流窗口时，后台重登一次并无缝恢复，不打断用户当前页面
    if (saved?.username && saved?.password && !throttled) {
      showToast('校园认证已过期，正在静默续期…', 2600);
      try {
        const data = await backend.login(saved.username, saved.password);
        const defaultSem = pickDefaultSemester(data.defaultSemester, data.semesters || []);
        features.forEach((f) => f.setSemesters?.(data.semesters || [], defaultSem));
        store.saveSession({
          sessionId: data.sessionId,
          username: saved.username,
          semesters: data.semesters || [],
          defaultSemester: defaultSem,
        });
        store.saveLoginTime();
        if (backend.isNative() && backend.saveCookies) await backend.saveCookies();
        showToast('认证已自动续期', 2000, 'success');
        return true;
      } catch (e) {
        if (/频繁|锁定|封|限制|风控/.test(e.message || '')) {
          store.clearCredentials();
          store.clearLoginTime();
        }
        showToast(e.message || '自动续期失败，请重新登录', 3000, 'error');
      }
    } else {
      showToast('认证会话已过期，请重新登录', 2600, 'error');
    }

    // 无法静默续期 -> 安全退回登录页
    store.clearSession();
    features.forEach((f) => f.reset?.());
    activeFeatureId = null;
    prefillCredentials();
    showView('login');
    return false;
  })();

  try {
    return await reloginPromise;
  } finally {
    reloginPromise = null;
  }
}

function prefillCredentials() {
  const saved = store.loadCredentials();
  if (saved) {
    $('username').value = saved.username || '';
    $('password').value = saved.password || '';
    $('auto-login').checked = true;
  }
}

// ---- 登录提交 ----
async function handleLogin(event) {
  event.preventDefault();
  hideError($('login-error'));
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) {
    showError($('login-error'), '请输入学号和密码');
    return;
  }

  setLoading($('login-btn'), true);
  try {
    const data = await backend.login(username, password);
    if ($('auto-login').checked) store.saveCredentials(username, password);
    else store.clearCredentials();

    const defaultSem = pickDefaultSemester(data.defaultSemester, data.semesters || []);
    features.forEach((f) => f.reset?.());
    features.forEach((f) => f.setSemesters?.(data.semesters || [], defaultSem));
    store.saveSession({
      sessionId: data.sessionId,
      username,
      semesters: data.semesters || [],
      defaultSemester: defaultSem,
    });
    store.saveLoginTime();
    if (backend.isNative() && backend.saveCookies) await backend.saveCookies();

    updateUserBadge(username);
    $('password').value = '';
    showView('main');
    showToast('登录成功，全功能已免登就绪', 2200, 'success');
    activateFeature(DEFAULT_FEATURE);
  } catch (e) {
    showError($('login-error'), e.message);
    if (/频繁|锁定|封|限制|风控/.test(e.message || '')) {
      store.clearCredentials();
      store.clearLoginTime();
      $('auto-login').checked = false;
    }
  } finally {
    setLoading($('login-btn'), false);
  }
}

// ---- 退出登录（带确认弹窗，避免误触；清空本机凭据与缓存防串号） ----
function promptLogout() {
  const modal = openModal({
    title: '退出登录',
    bodyHtml: '<p class="modal-confirm-text">确定要退出当前账号吗？本机保存的登录态、缓存与自动登录凭据将被清除。</p>',
    actionsHtml: `
      <button type="button" class="btn btn-secondary" id="modal-cancel-logout">取消</button>
      <button type="button" class="btn btn-danger" id="modal-confirm-logout">确认退出</button>`,
  });
  modal?.querySelector('#modal-cancel-logout')?.addEventListener('click', closeModal);
  modal?.querySelector('#modal-confirm-logout')?.addEventListener('click', async () => {
    closeModal();
    await performLogout();
  });
}

async function performLogout() {
  await backend.logout?.();
  store.clearAccountOnLogout();
  features.forEach((f) => f.reset?.());
  activeFeatureId = null;
  updateUserBadge('');
  $('username').value = '';
  $('password').value = '';
  $('auto-login').checked = false;
  showView('login');
  showToast('已安全退出登录');
}

// ---- 启动恢复会话（修复原 Web 模式刷新丢 sessionId 的 bug） ----
async function initSession() {
  const s = store.loadSession();
  if (!s || !s.semesters.length) return false;

  const valid = await backend.restoreSession?.(s.sessionId);
  if (valid === false) {
    // Web 端后端可能已重启导致内存会话丢失：若勾选了自动登录且未节流，走自动重登
    store.clearSession();
    return false;
  }

  features.forEach((f) => f.setSemesters?.(s.semesters, s.defaultSemester));
  updateUserBadge(s.username);
  showView('main');
  activateFeature(DEFAULT_FEATURE);
  return true;
}

// ---- 自动登录（带 30 分钟节流防风控） ----
function tryAutoLogin() {
  const saved = store.loadCredentials();
  if (!saved?.username || !saved?.password) return false;
  const last = store.getLastLoginTime();
  const elapsed = Date.now() - last;
  if (last > 0 && elapsed < LOGIN_THROTTLE_MS) {
    prefillCredentials();
    const mins = Math.ceil((LOGIN_THROTTLE_MS - elapsed) / 60000);
    showToast(`为避免频繁登录触发风控，请 ${mins} 分钟后自动登录或手动点击登录`, 3200);
    return false;
  }
  prefillCredentials();
  showView('login');
  setTimeout(() => $('login-form').requestSubmit(), 0);
  return true;
}

// ---- 密码显隐切换 ----
function setupPasswordToggle() {
  const btn = $('toggle-password');
  const input = $('password');
  if (!btn || !input) return;
  btn.innerHTML = iconEye;
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.innerHTML = showing ? iconEye : iconEyeOff;
    btn.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
  });
}

// ---- 应用启动 ----
async function boot() {
  applyTheme(store.loadTheme());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (store.loadTheme() === 'auto') applyTheme('auto');
  });

  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });

  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.innerHTML = `<span class="btn-icon">${iconLogout}</span><span class="logout-label">退出</span>`;
    logoutBtn.addEventListener('click', promptLogout);
  }

  setupPasswordToggle();
  backend = await pickBackend();
  buildChrome();

  $('login-form').addEventListener('submit', handleLogin);

  if (await initSession()) return;
  if (!tryAutoLogin()) {
    prefillCredentials();
    showView('login');
  }
}

document.addEventListener('DOMContentLoaded', boot);
