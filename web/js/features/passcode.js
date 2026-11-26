// ============ 功能模块：校园通行码（河海大学统一智慧泛门禁系统 zhjc.hhu.edu.cn） ============
// 原为微信 H5（https://zhjc.hhu.edu.cn/#/pages/wxFrontPage/index）。
// 现复用 HHU+ 单次 CAS 登录态自动单点换票获取通行码，无需微信、无需重复登录！
//
// 能力：
//   - 高对比纯白二维码扫描区（暗色模式下亦保持纯白底与留白，确保校门闸机秒扫）
//   - 实时倒计时进度条 + 有效期展示 + 过期自动遮罩一键刷新
//   - 持卡人身份信息（姓名 / 学院部门 / 学号 / 校园照片）
//   - 快捷入口：打开官方门禁页（办理访客预约、人脸采集等扩展服务）

import { esc, formatDateTime } from '../ui.js';
import { iconQrCode, iconRefresh, iconExternal, iconShieldCheck } from '../icons.js';

let currentGetCtx = null;
let countdownTimer = null;
let currentExpireTime = 0;
let totalDurationMs = 60_000;
let isFetching = false;

const panel = {
  el: null, card: null, statusPill: null, statusText: null,
  qrImg: null, qrSkeleton: null, expiredOverlay: null,
  expireText: null, remainText: null, progressFill: null,
  avatar: null, name: null, dept: null, code: null,
  refreshBtn: null, openOfficialBtn: null, error: null,
};

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function setExpiredState(expired) {
  if (!panel.card) return;
  panel.card.classList.toggle('is-expired', expired);
  if (panel.expiredOverlay) panel.expiredOverlay.hidden = !expired;
  if (panel.statusPill) {
    panel.statusPill.classList.toggle('status-valid', !expired);
    panel.statusPill.classList.toggle('status-expired', expired);
  }
  if (panel.statusText) panel.statusText.textContent = expired ? '通行码已过期' : '通行有效';
}

function updateCountdownTick() {
  const now = Date.now();
  const remainMs = currentExpireTime - now;
  if (remainMs <= 0) {
    clearCountdown();
    setExpiredState(true);
    if (panel.remainText) panel.remainText.textContent = '已过期，请刷新';
    if (panel.progressFill) panel.progressFill.style.width = '0%';
    return;
  }
  setExpiredState(false);
  const sec = Math.ceil(remainMs / 1000);
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (panel.remainText) {
    panel.remainText.textContent = mins > 0 ? `剩余 ${mins}分${String(remSec).padStart(2, '0')}秒` : `剩余 ${sec} 秒`;
  }
  if (panel.progressFill) {
    const pct = Math.max(0, Math.min(100, (remainMs / totalDurationMs) * 100));
    panel.progressFill.style.width = `${pct.toFixed(1)}%`;
  }
}

function startCountdown(expireTime) {
  clearCountdown();
  currentExpireTime = Number(expireTime) || 0;
  const diff = currentExpireTime - Date.now();
  totalDurationMs = diff > 1000 ? diff : 60_000;
  if (panel.expireText) {
    panel.expireText.textContent = currentExpireTime ? `有效期至 ${formatDateTime(currentExpireTime)}` : '';
  }
  updateCountdownTick();
  if (diff > 0) {
    countdownTimer = setInterval(updateCountdownTick, 1000);
  }
}

function renderUserInfo(user = {}) {
  const name = user.name || '河海师生';
  if (panel.name) panel.name.textContent = name;
  if (panel.dept) panel.dept.textContent = user.dept || '河海大学';
  if (panel.code) panel.code.textContent = user.code ? `编号 ${user.code}` : '';

  if (panel.avatar) {
    if (user.photoDataUrl) {
      panel.avatar.innerHTML = `<img src="${esc(user.photoDataUrl)}" alt="${esc(name)}">`;
    } else {
      const initial = name.slice(-2) || '河海';
      panel.avatar.innerHTML = `<span class="avatar-initials">${esc(initial)}</span>`;
    }
  }
}

async function fetchPassCode(ctx, { refreshUser = false } = {}) {
  if (isFetching) return;
  const { backend, store, ui, onSessionExpired } = ctx;
  if (!backend) { ui.showError(panel.error, '会话已失效，请重新登录'); return; }

  isFetching = true;
  ui.hideError(panel.error);
  ui.setLoading(panel.refreshBtn, true);
  if (panel.qrSkeleton && !panel.qrImg.getAttribute('src')) {
    panel.qrSkeleton.hidden = false;
  }

  try {
    const { qr, user } = await backend.queryPassCode({ refreshUser });
    if (user && (user.name || user.code || user.dept)) {
      renderUserInfo(user);
      store.savePassCodeUser(user);
    }
    if (qr?.qrCodeImage) {
      panel.qrImg.src = qr.qrCodeImage;
      panel.qrImg.hidden = false;
      if (panel.qrSkeleton) panel.qrSkeleton.hidden = true;
    } else {
      throw new Error('接口未返回二维码图片，请点击「打开官方门禁页」查看');
    }
    startCountdown(qr.expireTime);
  } catch (e) {
    if (/(会话|登录|过期)/.test(e.message) || e.status === 401) {
      isFetching = false;
      const recovered = await onSessionExpired?.();
      if (recovered) return fetchPassCode(currentGetCtx(), { refreshUser });
    }
    ui.showError(panel.error, e.message);
    if (panel.qrSkeleton) panel.qrSkeleton.hidden = true;
  } finally {
    isFetching = false;
    ui.setLoading(panel.refreshBtn, false);
  }
}

export default {
  id: 'passcode',
  label: '通行码',
  title: '校园通行码',
  icon: iconQrCode,
  type: 'panel',

  render({ el, getCtx }) {
    currentGetCtx = getCtx;
    el.innerHTML = `
      <div class="passcode-layout">
        <div class="error-msg" id="passcode-error" hidden></div>

        <article class="pass-card" id="passcode-card">
          <div class="pass-card-head">
            <div class="pass-brand">
              <span class="pass-shield">${iconShieldCheck}</span>
              <div>
                <div class="pass-school">河海大学 · 智慧门禁</div>
                <div class="pass-sub">校园入校通行码</div>
              </div>
            </div>
            <span class="pass-status status-valid" id="passcode-status">
              <span class="status-dot"></span>
              <span id="passcode-status-text">加载中</span>
            </span>
          </div>

          <div class="pass-card-body">
            <div class="qr-stage" id="passcode-qr-stage">
              <div class="qr-skeleton" id="passcode-skeleton">
                <div class="spinner"></div>
                <span>正在经统一认证获取通行码…</span>
              </div>
              <img id="passcode-img" class="qr-image" alt="河海大学校园通行码" hidden>
              <button type="button" class="qr-expired-overlay" id="passcode-expired" hidden>
                <span class="qr-expired-icon">${iconRefresh}</span>
                <span class="qr-expired-title">通行码已过期</span>
                <span class="qr-expired-sub">点击刷新获取新码</span>
              </button>
            </div>

            <div class="pass-countdown">
              <div class="pass-countdown-meta">
                <span id="passcode-expire" class="tabular-nums">等待加载有效期</span>
                <span id="passcode-remain" class="pass-remain tabular-nums"></span>
              </div>
              <div class="pass-progress-track">
                <div class="pass-progress-fill" id="passcode-progress"></div>
              </div>
            </div>

            <div class="pass-identity">
              <div class="pass-avatar" id="passcode-avatar">
                <span class="avatar-initials">河海</span>
              </div>
              <div class="pass-person">
                <div class="pass-person-name" id="passcode-name">—</div>
                <div class="pass-person-dept" id="passcode-dept">河海大学统一智慧泛门禁系统</div>
                <div class="pass-person-code tabular-nums" id="passcode-code"></div>
              </div>
            </div>
          </div>

          <div class="pass-card-actions">
            <button type="button" class="btn btn-primary" id="passcode-refresh">
              <span class="btn-icon">${iconRefresh}</span>
              <span class="btn-text">刷新通行码</span>
              <span class="btn-spinner" hidden></span>
            </button>
            <button type="button" class="btn btn-secondary" id="passcode-official">
              <span class="btn-icon">${iconExternal}</span>
              <span class="btn-text">官方门禁页</span>
            </button>
          </div>
        </article>

        <p class="pass-footnote">
          已复用当前统一身份认证会话自动获取，无需微信与重复登录；请将二维码对准校门闸机扫码口。
        </p>
      </div>`;

    panel.el = el;
    panel.card = el.querySelector('#passcode-card');
    panel.statusPill = el.querySelector('#passcode-status');
    panel.statusText = el.querySelector('#passcode-status-text');
    panel.qrImg = el.querySelector('#passcode-img');
    panel.qrSkeleton = el.querySelector('#passcode-skeleton');
    panel.expiredOverlay = el.querySelector('#passcode-expired');
    panel.expireText = el.querySelector('#passcode-expire');
    panel.remainText = el.querySelector('#passcode-remain');
    panel.progressFill = el.querySelector('#passcode-progress');
    panel.avatar = el.querySelector('#passcode-avatar');
    panel.name = el.querySelector('#passcode-name');
    panel.dept = el.querySelector('#passcode-dept');
    panel.code = el.querySelector('#passcode-code');
    panel.refreshBtn = el.querySelector('#passcode-refresh');
    panel.openOfficialBtn = el.querySelector('#passcode-official');
    panel.error = el.querySelector('#passcode-error');

    const doRefresh = () => fetchPassCode(currentGetCtx(), { refreshUser: false });
    panel.refreshBtn.addEventListener('click', doRefresh);
    panel.expiredOverlay.addEventListener('click', doRefresh);
    panel.openOfficialBtn.addEventListener('click', () => {
      const ctx = currentGetCtx();
      ctx.backend?.openPassCodeWeb?.().catch((e) => ctx.ui.showToast(e.message, 2600, 'error'));
    });
  },

  onActivate(ctx) {
    // 先从缓存渲染持卡人信息（秒开），若无有效通行码或已临近过期（<10s）则自动拉新码
    const cachedUser = ctx.store.loadPassCodeUser();
    if (cachedUser) renderUserInfo(cachedUser);

    const hasFreshQr = currentExpireTime - Date.now() > 10_000 && panel.qrImg?.getAttribute('src');
    if (!hasFreshQr) {
      fetchPassCode(ctx, { refreshUser: !cachedUser });
    } else {
      updateCountdownTick();
      if (!countdownTimer) countdownTimer = setInterval(updateCountdownTick, 1000);
    }
  },

  onDeactivate() {
    clearCountdown();
  },

  reset() {
    clearCountdown();
    currentExpireTime = 0;
    isFetching = false;
    if (panel.qrImg) { panel.qrImg.removeAttribute('src'); panel.qrImg.hidden = true; }
    if (panel.qrSkeleton) panel.qrSkeleton.hidden = false;
    if (panel.expiredOverlay) panel.expiredOverlay.hidden = true;
    if (panel.error) { panel.error.hidden = true; panel.error.textContent = ''; }
    if (panel.name) panel.name.textContent = '—';
    if (panel.dept) panel.dept.textContent = '河海大学统一智慧泛门禁系统';
    if (panel.code) panel.code.textContent = '';
    if (panel.avatar) panel.avatar.innerHTML = '<span class="avatar-initials">河海</span>';
    if (panel.statusText) panel.statusText.textContent = '加载中';
  },
};
