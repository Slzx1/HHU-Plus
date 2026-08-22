// ============ 通用 UI 工具（toast/错误/加载/下拉） ============
// 不绑定具体功能，供各 feature 与 app 共用。

export const $ = (id) => document.getElementById(id);

/** HTML 转义（渲染学校返回的课程名/教师/教室等文本时使用，防注入）。 */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 顶部轻提示。 */
let toastTimer = null;
export function showToast(msg, duration = 2000) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

/** 显示/隐藏错误提示文本块。 */
export function showError(el, msg) { if (el) { el.textContent = msg; el.hidden = false; } }
export function hideError(el) { if (el) { el.hidden = true; el.textContent = ''; } }

/** 按钮加载态：禁用 + 切换 spinner。 */
export function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  if (text) text.style.opacity = loading ? '0.7' : '1';
  if (spinner) spinner.hidden = !loading;
}

/** 填充学期下拉框。first 为「全部学期 / 当前学期」占位文本。 */
export function fillSemesterSelect(selectEl, list, firstLabel = '全部学期') {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">${firstLabel}</option>`;
  (list || []).forEach((s) => {
    if (!s.value) return;  // 跳过空 value（与「全部」重复）
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.text || s.value;
    selectEl.appendChild(opt);
  });
}

/** 填充周次下拉框（第 1~30 周）。 */
export function fillWeekSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">全部</option>';
  for (let i = 1; i <= 30; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `第${i}周`;
    selectEl.appendChild(opt);
  }
}
