// ============ 功能模块：办事大厅（taskcenter） ============
// - APK 端：直接以移动 UA 打开共享 Cookie 的 InAppBrowser（一次登录免重登），并保持当前面板高亮不错乱
// - Web 端：通过后端 /proxy/open/classroom 携带同一份服务端 CookieJar 免重登嵌入打开，并支持新标签页全屏打开

import { CLASSROOM_URL } from '../config.js';
import { iconClassroom, iconExternal, iconRefresh, iconShieldCheck } from '../icons.js';

let currentGetCtx = null;
let loadedSrc = '';
const panel = { frame: null, status: null, openTabBtn: null, reloadBtn: null };

function loadPortal(ctx, force = false) {
  const url = ctx.backend?.getProxyUrl?.('classroom');
  if (!url || !panel.frame) return;
  if (!force && loadedSrc === url) return;
  loadedSrc = url;
  panel.frame.src = url;
}

export default {
  id: 'classroom',
  label: '办事大厅',
  title: '河海办事大厅',
  icon: iconClassroom,
  type: 'portal',

  render({ el, getCtx }) {
    currentGetCtx = getCtx;
    el.innerHTML = `
      <div class="card portal-shell">
        <div class="portal-bar">
          <div class="portal-bar-info">
            <span class="portal-badge">${iconShieldCheck} 已免登接入</span>
            <span class="portal-desc">请假审批 · 教室借用 · 校园事务</span>
          </div>
          <div class="portal-bar-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="classroom-reload">
              <span class="btn-icon">${iconRefresh}</span><span>刷新</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="classroom-open-tab">
              <span class="btn-icon">${iconExternal}</span><span>新标签页</span>
            </button>
            <a class="btn btn-ghost btn-sm" href="${CLASSROOM_URL}" target="_blank" rel="noopener">官网直达</a>
          </div>
        </div>
        <div class="portal-frame-wrap">
          <iframe id="classroom-frame" class="portal-frame" title="河海大学办事大厅" referrerpolicy="no-referrer"></iframe>
        </div>
      </div>`;

    panel.frame = el.querySelector('#classroom-frame');
    panel.reloadBtn = el.querySelector('#classroom-reload');
    panel.openTabBtn = el.querySelector('#classroom-open-tab');

    panel.reloadBtn.addEventListener('click', () => loadPortal(currentGetCtx(), true));
    panel.openTabBtn.addEventListener('click', () => {
      const ctx = currentGetCtx();
      ctx.backend?.openClassroom?.().catch((e) => ctx.ui.showToast(e.message, 2600, 'error'));
    });
  },

  onActivate(ctx) {
    // APK 原生端直接唤起共享会话的 InAppBrowser，返回 { keepPanel: true } 不改变底层面板
    if (ctx.backend?.isNative?.()) {
      ctx.backend.openClassroom().catch((e) => ctx.ui.showToast(e.message, 2600, 'error'));
      return { keepPanel: true };
    }
    loadPortal(ctx, false);
    return { keepPanel: false };
  },

  reset() {
    loadedSrc = '';
    if (panel.frame) panel.frame.src = 'about:blank';
  },
};
