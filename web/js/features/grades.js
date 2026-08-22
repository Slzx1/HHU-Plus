// ============ 功能模块：成绩查询 ============
// 自注册：app.js 从 features/index.js 拿到本模块，按描述生成 tab 与面板。
// 本模块负责「查询成绩 + 渲染 GPA 卡片 + 成绩表」。

import { GRADE_LEVELS } from '../config.js';
import { esc, fillSemesterSelect } from '../ui.js';
import { iconGrades } from '../icons.js';

let built = false;        // 面板是否已挂到 DOM
let loaded = false;       // 是否已成功查询过（决定首次是否自动加载）

const panel = { el: null, semester: null, gpa: null, list: null, error: null, loading: null, queryBtn: null, result: null };

function gradeKeyFor(value) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  for (const lv of GRADE_LEVELS) if (n >= lv.min) return lv.key;
  return null;
}

function renderGpaCards(info = {}) {
  const cfg = [
    ['学位绩点', 'highlight'], ['平均学分绩点', 'highlight'], ['平均成绩', 'highlight'],
    ['所修门数', ''], ['所修总学分', ''], ['专业排名', ''], ['推优绩点', ''],
    ['推优平均成绩', ''], ['出国就业平均成绩', ''],
  ];
  panel.gpa.innerHTML = cfg
    .filter(([k]) => info[k] !== undefined)
    .map(([k, hl]) => `<div class="gpa-card"><div class="label">${k}</div><div class="value ${hl}">${esc(info[k])}</div></div>`)
    .join('');
}

/** 按表头关键字定位列索引（先精确再模糊，支持排除词）。 */
function findColIdx(headers, key, excludes = []) {
  for (let i = 0; i < headers.length; i++) if (headers[i] === key) return i;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].includes(key) && !excludes.some((e) => headers[i].includes(e))) return i;
  }
  return -1;
}

/**
 * 渲染成绩明细为「卡片式列表」（手机原生、无需横向滚动）。
 * 每行：左=课程名+开课学期；右=成绩(按梯度着色)+学分/绩点。
 */
function renderGradeList(grades = { headers: [], rows: [] }) {
  const { headers, rows } = grades;
  if (!rows.length) { panel.list.innerHTML = '<div class="empty">暂无成绩数据</div>'; return; }

  const iSem = findColIdx(headers, '开课学期');
  const iName = findColIdx(headers, '课程名称', ['代码', '性质', '属性']);
  const iCredit = findColIdx(headers, '学分');
  const iScore = findColIdx(headers, '成绩', ['性质', '标识']);
  const iGpa = findColIdx(headers, '绩点');

  panel.list.innerHTML = rows.map((r) => {
    const sem = iSem >= 0 ? (r[iSem] || '') : '';
    const name = iName >= 0 ? (r[iName] || '') : '';
    const credit = iCredit >= 0 ? (r[iCredit] || '') : '';
    const score = iScore >= 0 ? (r[iScore] || '') : '';
    const gpa = iGpa >= 0 ? (r[iGpa] || '') : '';
    const key = gradeKeyFor(score);
    return `<div class="grade-item">
      <div class="grade-main">
        <div class="grade-name">${esc(name)}</div>
        ${sem ? `<div class="grade-sem">${esc(sem)}</div>` : ''}
      </div>
      <div class="grade-side">
        <div class="grade-score${key ? ` score-${key}` : ''}">${esc(score)}</div>
        ${(credit || gpa) ? `<div class="grade-sub">${credit ? `学分 ${esc(credit)}` : ''}${credit && gpa ? ' · ' : ''}${gpa ? `绩点 ${esc(gpa)}` : ''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function query({ backend, store, ui, onSessionExpired }) {
  ui.hideError(panel.error);
  if (!backend) { ui.showError(panel.error, '会话已失效，请重新登录'); return; }
  const semester = panel.semester.value || null;
  ui.setLoading(panel.queryBtn, true);
  panel.loading.hidden = false;
  panel.result.hidden = true;
  try {
    const { gpaInfo, grades } = await backend.query(semester);
    renderGpaCards(gpaInfo);
    renderGradeList(grades);
    panel.result.hidden = false;
    loaded = true;
    store.saveGradesCache(gpaInfo, grades);
  } catch (e) {
    ui.showError(panel.error, e.message);
    if (/(会话|登录)/.test(e.message)) onSessionExpired?.();
  } finally {
    ui.setLoading(panel.queryBtn, false);
    panel.loading.hidden = true;
  }
}

export default {
  id: 'grades',
  label: '成绩',
  icon: iconGrades,
  type: 'panel',

  render({ el, backend, store, ui, onSessionExpired }) {
    el.innerHTML = `
      <div class="query-bar card">
        <div class="field"><label>开课时间</label>
          <select id="grades-semester"><option value="">全部学期</option></select>
        </div>
        <button class="btn btn-primary" id="grades-query"><span class="btn-text">查询</span><span class="btn-spinner" hidden></span></button>
      </div>
      <div class="error-msg" id="grades-error" hidden></div>
      <div class="loading" id="grades-loading" hidden><div class="spinner"></div><p>正在查询...</p></div>
      <section id="grades-result" hidden>
        <div class="gpa-grid" id="grades-gpa"></div>
        <div class="card"><h3 class="card-title">成绩明细</h3>
          <div class="grade-list" id="grades-list"></div>
        </div>
      </section>`;

    panel.el = el;
    panel.semester = el.querySelector('#grades-semester');
    panel.queryBtn = el.querySelector('#grades-query');
    panel.gpa = el.querySelector('#grades-gpa');
    panel.list = el.querySelector('#grades-list');
    panel.error = el.querySelector('#grades-error');
    panel.loading = el.querySelector('#grades-loading');
    panel.result = el.querySelector('#grades-result');
    if (panel.result) panel.result.hidden = true;
    panel.queryBtn.addEventListener('click', () => query({ backend, store, ui, onSessionExpired }));
    built = true;
  },

  // 登录后填充学期下拉（由 app.js 调用传入 semesters 与默认项）
  setSemesters(semesters, defaultSem) {
    if (!panel.semester) return;
    fillSemesterSelect(panel.semester, semesters, '全部学期');
    if (defaultSem) panel.semester.value = defaultSem;
  },

  onActivate(ctx) {
    if (built && !loaded) query(ctx);   // 首次激活自动查询一次
  },

  reset() { built = false; loaded = false; },
};
