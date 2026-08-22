// ============ 应用装配器（主程序，尽量薄） ============
// 只做「选平台 + 注册 feature + 登录/会话编排」，各功能逻辑都在 features/ 里。
// 新增功能：在 features/index.js 加一行即可，本文件无需改。

import { features } from './features/index.js';
import { pickBackend } from './platform/index.js';
import { store, pickDefaultSemester } from './store.js';
import { $, showToast, setLoading, showError, hideError } from './ui.js';
import { LOGIN_THROTTLE_MS } from './config.js';

const DEFAULT_FEATURE = 'schedule';
const ui = { showToast, setLoading, showError, hideError };

let backend = null;
const tabBtns = new Map();
const panels = new Map();

// 运行时上下文，传给各 feature（backend 在 pickBackend 后注入）
function ctx() { return { backend, store, ui, onSessionExpired }; }

function showView(name) {
  $('login-view').classList.toggle('active', name === 'login');
  $('main-view').classList.toggle('active', name === 'main');
}

// ---- 由 feature 注册表生成 tab 与面板容器 ----
function buildChrome() {
  const nav = $('bottom-nav');
  const content = $('content');
  features.forEach((f) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.id = f.id;
    btn.innerHTML = `<span class="tab-icon">${f.icon}</span><span class="tab-label">${f.label}</span>`;
    btn.addEventListener('click', () => activateFeature(f.id));
    nav.appendChild(btn);
    tabBtns.set(f.id, btn);

    if (f.type === 'panel') {
      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.dataset.panel = f.id;
      content.appendChild(panel);
      f.render({ el: panel, ...ctx() });
      panels.set(f.id, panel);
    }
  });
}

function activateFeature(id) {
  const f = features.find((x) => x.id === id);
  if (!f) return;
  tabBtns.forEach((btn, bid) => btn.classList.toggle('active', bid === id));
  if (f.type === 'external') { f.onActivate(ctx()); return; }   // 直接跳转，不切面板
  panels.forEach((el, pid) => el.classList.toggle('active', pid === id));
  f.onActivate(ctx());
}

// ---- 会话过期：优先自动重登（带节流），否则回登录页 ----
function onSessionExpired() {
  store.clearSession();
  features.forEach((f) => f.reset?.());   // 重置各功能数据，重登后重新加载
  prefillCredentials();
  showView('login');

  const saved = store.loadCredentials();
  const last = store.getLastLoginTime();
  const throttled = last > 0 && (Date.now() - last) < LOGIN_THROTTLE_MS;  // 30 分钟节流防风控
  if (saved && saved.username && !throttled) {
    // 没过节流 → 自动用已存凭据重登（正是「过期自动重登、没过期用原请求」）
    showToast('会话已过期，正在自动重新登录');
    setTimeout(() => $('login-form').requestSubmit(), 0);
  } else {
    showToast('会话已过期，请重新登录');
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

// ---- 登录 ----
async function handleLogin(event) {
  event.preventDefault();
  hideError($('login-error'));
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) { showError($('login-error'), '请输入学号和密码'); return; }

  setLoading($('login-btn'), true);
  try {
    const data = await backend.login(username, password);
    if ($('auto-login').checked) store.saveCredentials(username, password);
    else store.clearCredentials();

    const defaultSem = pickDefaultSemester(data.defaultSemester, data.semesters || []);
    features.forEach((f) => f.setSemesters?.(data.semesters || [], defaultSem));
    store.saveSession({ sessionId: data.sessionId, semesters: data.semesters || [], defaultSemester: defaultSem });
    store.saveLoginTime();
    if (backend.isNative() && backend.saveCookies) await backend.saveCookies();

    $('password').value = '';
    showView('main');
    showToast('登录成功');
    activateFeature(DEFAULT_FEATURE);
  } catch (e) {
    showError($('login-error'), e.message);
    // 风控提示则清除自动登录凭据并复位
    if (/频繁|锁定|封|限制|风控/.test(e.message || '')) {
      store.clearCredentials(); store.clearLoginTime(); $('auto-login').checked = false;
    }
  } finally {
    setLoading($('login-btn'), false);
  }
}

// ---- 退出 ----
async function handleLogout() {
  await backend.logout?.();
  store.clearSession();
  store.clearLoginTime();
  features.forEach((f) => f.reset?.());
  $('username').value = '';
  $('password').value = '';
  showView('login');
  showToast('已退出');
  prefillCredentials();
}

// ---- 会话恢复 ----
function initSession() {
  const s = store.loadSession();
  if (!s || !s.semesters.length) return false;
  features.forEach((f) => f.setSemesters?.(s.semesters, s.defaultSemester));
  showView('main');
  // APK 先恢复持久化 cookie 再发请求；浏览器直接请求（后端校验 session_id）
  if (backend.restoreCookies) {
    backend.restoreCookies().then(() => { activateFeature(DEFAULT_FEATURE); });
  } else {
    activateFeature(DEFAULT_FEATURE);
  }
  return true;
}

// ---- 自动登录（带节流防风控） ----
function tryAutoLogin() {
  const saved = store.loadCredentials();
  if (!saved || !saved.username || !saved.password) return false;
  const last = store.getLastLoginTime();
  const elapsed = Date.now() - last;
  if (last > 0 && elapsed < LOGIN_THROTTLE_MS) {
    const mins = Math.ceil((LOGIN_THROTTLE_MS - elapsed) / 60000);
    showToast(`为避免频繁登录触发风控，请 ${mins} 分钟后再试，或手动登录`);
    return false;
  }
  $('username').value = saved.username;
  $('password').value = saved.password;
  $('auto-login').checked = true;
  setTimeout(() => $('login-form').requestSubmit(), 0);
  return true;
}

// ---- 启动 ----
async function boot() {
  backend = await pickBackend();
  buildChrome();

  $('login-form').addEventListener('submit', handleLogin);
  $('logout-btn').addEventListener('click', handleLogout);

  if (initSession()) return;                 // 有本地会话 → 显示主界面并发起请求
  if (!tryAutoLogin()) showView('login');    // 无凭据 → 登录页；否则自动提交
}

document.addEventListener('DOMContentLoaded', boot);
