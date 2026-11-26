// ============ 通用 UI 工具（toast / 错误 / 加载 / 下拉 / 弹窗 / 时间格式化） ============

import { iconClose } from './icons.js';

export const $ = (id) => document.getElementById(id);

/** HTML 转义（防 XSS）。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 轻量浮层提示（支持 tone: 'default' | 'success' | 'error'）。 */
let toastTimer = null;
export function showToast(msg, duration = 2400, tone = 'default') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.dataset.tone = tone;
  el.hidden = false;
  el.classList.remove('toast-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

/** 错误提示文本块。 */
export function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
export function hideError(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

/** 按钮加载态：禁用 + 切换 spinner。 */
export function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  const spinner = btn.querySelector('.btn-spinner');
  if (spinner) spinner.hidden = !loading;
}

/** 填充学期下拉框。 */
export function fillSemesterSelect(selectEl, list, firstLabel = '全部学期') {
  if (!selectEl) return;
  const currentVal = selectEl.value;
  selectEl.innerHTML = `<option value="">${esc(firstLabel)}</option>`;
  (list || []).forEach((s) => {
    if (!s.value) return;
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.text || s.value;
    selectEl.appendChild(opt);
  });
  if (currentVal && Array.from(selectEl.options).some((o) => o.value === currentVal)) {
    selectEl.value = currentVal;
  }
}

/** 填充周次下拉框（第 1~30 周）。 */
export function fillWeekSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">全部周次</option>';
  for (let i = 1; i <= 30; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `第 ${i} 周`;
    selectEl.appendChild(opt);
  }
}

/** 格式化时间戳为 YYYY-MM-DD HH:mm:ss。 */
export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 格式化相对更新时间（供缓存状态提示用）。 */
export function formatSyncTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚更新';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前更新`;
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 更新`;
}

// ---- 通用模态弹层 / 底部抽屉（用于课程详情、退出确认等） ----
export function openModal({ title = '', bodyHtml = '', actionsHtml = '' } = {}) {
  const overlay = $('modal-overlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-header">
        <h3 class="modal-title">${esc(title)}</h3>
        <button type="button" class="icon-btn modal-close" aria-label="关闭">${iconClose}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : ''}
    </div>`;
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => closeModal();
  overlay.querySelector('.modal-close')?.addEventListener('click', close);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  return overlay;
}

export function closeModal() {
  const overlay = $('modal-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.classList.remove('open');
  setTimeout(() => {
    if (!overlay.classList.contains('open')) {
      overlay.hidden = true;
      overlay.innerHTML = '';
    }
  }, 180);
}
