// ============ 功能模块：奥兰学生管理信息系统（smst.hhu.edu.cn） ============
// - APK 端：经 CAS 单点登录以移动 UA 打开共享 Cookie 的 InAppBrowser，并延迟落盘 smst 设备标记 Cookie
// - Web 端：通过后端 /proxy/open/orlan 携带服务端 CookieJar 免重登嵌入打开，并支持新标签页全屏打开

import { ORLAN_URL } from '../config.js';
import { iconPerson, iconExternal, iconRefresh, iconShieldCheck } from '../icons.js';

let currentGetCtx = null;
let loadedSrc = '';
const panel = { frame: null, openTabBtn: null, reloadBtn: null };

function loadPortal(ctx, force = false) {
  const url = ctx.backend?.getProxyUrl?.('orlan');
  if (!url || !panel.frame) return;
  if (!force && loadedSrc === url) return;
  loadedSrc = url;
  panel.frame.src = url;
}

export default {
  id: 'orlan',
  label: '奥兰',
  title: '奥兰系统',
  icon: iconPerson,
  type: 'portal',

  render({ el, getCtx }) {
    currentGetCtx = getCtx;
    el.innerHTML = `
      <div class="card portal-shell">
        <div class="portal-bar">
          <div class="portal-bar-info">
            <span class="portal-badge">${iconShieldCheck} 已免登接入</span>
            <span class="portal-desc">学生信息 · 离校登记 · 宿舍管理</span>
          </div>
          <div class="portal-bar-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="orlan-reload">
              <span class="btn-icon">${iconRefresh}</span><span>刷新</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="orlan-open-tab">
              <span class="btn-icon">${iconExternal}</span><span>新标签页</span>
            </button>
            <a class="btn btn-ghost btn-sm" href="${ORLAN_URL}" target="_blank" rel="noopener">官网直达</a>
          </div>
        </div>
        <div class="portal-frame-wrap">
          <iframe id="orlan-frame" class="portal-frame" title="河海大学奥兰系统" referrerpolicy="no-referrer"></iframe>
        </div>
      </div>`;

    panel.frame = el.querySelector('#orlan-frame');
    panel.reloadBtn = el.querySelector('#orlan-reload');
    panel.openTabBtn = el.querySelector('#orlan-open-tab');

    panel.reloadBtn.addEventListener('click', () => loadPortal(currentGetCtx(), true));
    panel.openTabBtn.addEventListener('click', () => {
      const ctx = currentGetCtx();
      ctx.backend?.openOrlan?.().catch((e) => ctx.ui.showToast(e.message, 2600, 'error'));
    });
  },

  onActivate(ctx) {
    if (ctx.backend?.isNative?.()) {
      ctx.backend.openOrlan().catch((e) => ctx.ui.showToast(e.message, 2600, 'error'));
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
