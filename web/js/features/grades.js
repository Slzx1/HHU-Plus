// ============ 功能模块：成绩查询 ============
// 自注册。负责「查询成绩 + GPA 统计卡片（不含统计时间）+ 分布条 + 搜索排序 + 卡片式成绩明细」。

import { classifyGrade } from '../engine/parser.js';
import { esc, fillSemesterSelect, formatSyncTime } from '../ui.js';
import { iconGrades, iconRefresh, iconSearch } from '../icons.js';

let loaded = false;
let currentGetCtx = null;
let cachedGradesData = null; // { gpaInfo, grades }

const panel = {
  el: null, semester: null, gpaHero: null, gpaStats: null,
  dist: null, list: null, search: null, sort: null,
  error: null, loading: null, queryBtn: null, result: null,
  syncBadge: null, countLabel: null,
};

function findColIdx(headers, key, excludes = []) {
  for (let i = 0; i < headers.length; i++) if (headers[i] === key) return i;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].includes(key) && !excludes.some((e) => headers[i].includes(e))) return i;
  }
  return -1;
}

function renderGpaSection(info = {}) {
  // 主推核心 3 项（不含统计时间，遵守设计规范）
  const heroCfg = [
    { key: '学位绩点', label: '学位绩点' },
    { key: '平均学分绩点', label: '平均学分绩点' },
    { key: '平均成绩', label: '平均成绩' },
  ];
  const secondaryCfg = [
    '所修门数', '所修总学分', '专业排名', '推优绩点', '推优平均成绩', '出国就业平均成绩',
  ];

  const heroItems = heroCfg.filter((c) => info[c.key] !== undefined);
  const secondaryItems = secondaryCfg.filter((k) => info[k] !== undefined);

  if (heroItems.length) {
    panel.gpaHero.innerHTML = heroItems.map(({ key, label }) => `
      <div class="gpa-hero-item">
        <span class="gpa-hero-label">${esc(label)}</span>
        <span class="gpa-hero-value">${esc(info[key])}</span>
      </div>`).join('');
    panel.gpaHero.hidden = false;
  } else {
    panel.gpaHero.hidden = true;
  }

  if (secondaryItems.length) {
    panel.gpaStats.innerHTML = secondaryItems.map((k) => `
      <div class="gpa-stat-chip">
        <span class="label">${esc(k)}</span>
        <span class="value">${esc(info[k])}</span>
      </div>`).join('');
    panel.gpaStats.hidden = false;
  } else {
    panel.gpaStats.hidden = true;
  }
}

function parseRowObjects(grades = { headers: [], rows: [] }) {
  const { headers = [], rows = [] } = grades;
  const iSem = findColIdx(headers, '开课学期');
  const iName = findColIdx(headers, '课程名称', ['代码', '性质', '属性']);
  const iCredit = findColIdx(headers, '学分');
  const iScore = findColIdx(headers, '成绩', ['性质', '标识']);
  const iGpa = findColIdx(headers, '绩点');

  return rows.map((r, idx) => {
    const score = iScore >= 0 ? (r[iScore] || '') : '';
    const numScore = parseFloat(score);
    const credit = iCredit >= 0 ? (r[iCredit] || '') : '';
    const gpa = iGpa >= 0 ? (r[iGpa] || '') : '';
    const level = classifyGrade(score);
    return {
      idx,
      sem: iSem >= 0 ? (r[iSem] || '') : '',
      name: iName >= 0 ? (r[iName] || '') : '',
      credit,
      numCredit: parseFloat(credit) || 0,
      score,
      numScore: Number.isNaN(numScore) ? levelRank(level) : numScore,
      gpa,
      level,
    };
  });
}

function levelRank(level) {
  return { excellent: 95, good: 87, fair: 82, pass: 70, fail: 40 }[level] ?? -1;
}

function renderDistribution(items) {
  const counts = { excellent: 0, good: 0, fair: 0, pass: 0, fail: 0 };
  items.forEach((it) => { if (it.level && it.level in counts) counts[it.level]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) { panel.dist.hidden = true; return; }

  const meta = [
    ['excellent', '优秀'], ['good', '良好'], ['fair', '中等'], ['pass', '及格'], ['fail', '不及格'],
  ];
  const barSegs = meta
    .filter(([k]) => counts[k] > 0)
    .map(([k, label]) => `<span class="dist-seg seg-${k}" style="flex:${counts[k]}" title="${label} ${counts[k]} 门"></span>`)
    .join('');
  const legend = meta
    .filter(([k]) => counts[k] > 0)
    .map(([k, label]) => `<span class="dist-item"><i class="dist-dot seg-${k}"></i>${label} <b>${counts[k]}</b></span>`)
    .join('');

  panel.dist.innerHTML = `<div class="dist-bar">${barSegs}</div><div class="dist-legend">${legend}</div>`;
  panel.dist.hidden = false;
}

function renderFilteredGrades() {
  if (!cachedGradesData) return;
  let items = parseRowObjects(cachedGradesData.grades);

  const kw = (panel.search?.value || '').trim().toLowerCase();
  if (kw) {
    items = items.filter((it) =>
      it.name.toLowerCase().includes(kw) || it.sem.toLowerCase().includes(kw),
    );
  }

  const sortMode = panel.sort?.value || 'default';
  if (sortMode === 'score-desc') items.sort((a, b) => b.numScore - a.numScore);
  else if (sortMode === 'score-asc') items.sort((a, b) => a.numScore - b.numScore);
  else if (sortMode === 'credit-desc') items.sort((a, b) => b.numCredit - a.numCredit);

  if (panel.countLabel) panel.countLabel.textContent = `共 ${items.length} 门课程`;
  renderDistribution(items);

  if (!items.length) {
    panel.list.innerHTML = `<div class="empty">${kw ? '没有匹配的课程' : '暂无成绩数据'}</div>`;
    return;
  }

  // 卡片式成绩明细（左课程名+学期，右梯度着色成绩+学分/绩点）
  panel.list.innerHTML = items.map((it) => `
    <div class="grade-item">
      <div class="grade-main">
        <div class="grade-name">${esc(it.name)}</div>
        ${it.sem ? `<div class="grade-sem">${esc(it.sem)}</div>` : ''}
      </div>
      <div class="grade-side">
        <div class="grade-score${it.level ? ` score-${it.level}` : ''}">${esc(it.score)}</div>
        ${(it.credit || it.gpa) ? `<div class="grade-sub">${it.credit ? `学分 ${esc(it.credit)}` : ''}${it.credit && it.gpa ? ' · ' : ''}${it.gpa ? `绩点 ${esc(it.gpa)}` : ''}</div>` : ''}
      </div>
    </div>`).join('');
}

function updateSyncBadge(text, syncing = false) {
  if (!panel.syncBadge) return;
  panel.syncBadge.textContent = text;
  panel.syncBadge.classList.toggle('is-syncing', syncing);
  panel.syncBadge.hidden = !text;
}

function hydrateCache(store) {
  const cached = store.loadGradesCache();
  if (!cached?.grades) return false;
  cachedGradesData = { gpaInfo: cached.gpaInfo, grades: cached.grades };
  if (cached.meta?.semester && panel.semester) panel.semester.value = cached.meta.semester;
  renderGpaSection(cached.gpaInfo);
  renderFilteredGrades();
  panel.result.hidden = false;
  if (cached.updatedAt) updateSyncBadge(`已缓存 · ${formatSyncTime(cached.updatedAt)}`, false);
  return true;
}

async function query(ctx, { silent = false } = {}) {
  const { backend, store, ui, onSessionExpired } = ctx;
  ui.hideError(panel.error);
  if (!backend) { ui.showError(panel.error, '会话已失效，请重新登录'); return; }

  const semester = panel.semester.value || null;
  ui.setLoading(panel.queryBtn, true);
  if (!silent) {
    panel.loading.hidden = false;
    panel.result.hidden = true;
  } else {
    updateSyncBadge('正在同步最新成绩…', true);
  }

  try {
    const { gpaInfo, grades } = await backend.query(semester);
    cachedGradesData = { gpaInfo, grades };
    renderGpaSection(gpaInfo);
    renderFilteredGrades();
    panel.result.hidden = false;
    loaded = true;
    store.saveGradesCache(gpaInfo, grades, { semester: semester || '' });
    updateSyncBadge('刚刚同步', false);
  } catch (e) {
    if (/(会话|登录|过期)/.test(e.message) || e.status === 401) {
      const recovered = await onSessionExpired?.();
      if (recovered) return query(currentGetCtx(), { silent });
    }
    ui.showError(panel.error, e.message);
    if (cachedGradesData) {
      panel.result.hidden = false;
      updateSyncBadge('离线展示缓存', false);
    }
  } finally {
    ui.setLoading(panel.queryBtn, false);
    panel.loading.hidden = true;
  }
}

export default {
  id: 'grades',
  label: '成绩',
  title: '学业成绩',
  icon: iconGrades,
  type: 'panel',

  render({ el, getCtx }) {
    currentGetCtx = getCtx;
    el.innerHTML = `
      <div class="card toolbar-card">
        <div class="query-bar">
          <div class="field field-compact">
            <label for="grades-semester">开课学期</label>
            <select id="grades-semester"><option value="">全部学期</option></select>
          </div>
          <button type="button" class="btn btn-primary toolbar-btn" id="grades-query">
            <span class="btn-icon">${iconRefresh}</span>
            <span class="btn-text">查询</span>
            <span class="btn-spinner" hidden></span>
          </button>
        </div>
        <div class="toolbar-meta">
          <span class="meta-text" id="grades-count"></span>
          <span class="sync-pill" id="grades-sync" hidden></span>
        </div>
      </div>

      <div class="error-msg" id="grades-error" hidden></div>
      <div class="loading" id="grades-loading" hidden><div class="spinner"></div><p>正在获取成绩…</p></div>

      <section id="grades-result" hidden>
        <div class="gpa-hero-card" id="grades-gpa-hero" hidden></div>
        <div class="gpa-stats-grid" id="grades-gpa-stats" hidden></div>

        <div class="card grades-list-card">
          <div class="grades-list-header">
            <h3 class="card-title">成绩明细</h3>
            <div class="grades-filter-row">
              <div class="search-box">
                <span class="search-icon">${iconSearch}</span>
                <input type="search" id="grades-search" placeholder="筛选课程名…">
              </div>
              <select id="grades-sort" class="compact-select" aria-label="排序方式">
                <option value="default">默认排序</option>
                <option value="score-desc">成绩降序</option>
                <option value="score-asc">成绩升序</option>
                <option value="credit-desc">学分降序</option>
              </select>
            </div>
          </div>
          <div class="grade-dist" id="grades-dist" hidden></div>
          <div class="grade-list" id="grades-list"></div>
        </div>
      </section>`;

    panel.el = el;
    panel.semester = el.querySelector('#grades-semester');
    panel.queryBtn = el.querySelector('#grades-query');
    panel.gpaHero = el.querySelector('#grades-gpa-hero');
    panel.gpaStats = el.querySelector('#grades-gpa-stats');
    panel.dist = el.querySelector('#grades-dist');
    panel.list = el.querySelector('#grades-list');
    panel.search = el.querySelector('#grades-search');
    panel.sort = el.querySelector('#grades-sort');
    panel.error = el.querySelector('#grades-error');
    panel.loading = el.querySelector('#grades-loading');
    panel.result = el.querySelector('#grades-result');
    panel.syncBadge = el.querySelector('#grades-sync');
    panel.countLabel = el.querySelector('#grades-count');

    panel.queryBtn.addEventListener('click', () => query(currentGetCtx()));
    panel.semester.addEventListener('change', () => query(currentGetCtx()));
    panel.search.addEventListener('input', () => renderFilteredGrades());
    panel.sort.addEventListener('change', () => renderFilteredGrades());
  },

  setSemesters(semesters, defaultSem) {
    if (!panel.semester) return;
    fillSemesterSelect(panel.semester, semesters, '全部学期');
    if (defaultSem) panel.semester.value = defaultSem;
  },

  onActivate(ctx) {
    if (!loaded) {
      const hasCache = hydrateCache(ctx.store);
      query(ctx, { silent: hasCache });
    }
  },

  reset() {
    loaded = false;
    cachedGradesData = null;
    if (panel.result) panel.result.hidden = true;
    if (panel.list) panel.list.innerHTML = '';
    if (panel.gpaHero) panel.gpaHero.innerHTML = '';
    if (panel.gpaStats) panel.gpaStats.innerHTML = '';
    if (panel.search) panel.search.value = '';
    if (panel.error) { panel.error.hidden = true; panel.error.textContent = ''; }
    if (panel.syncBadge) panel.syncBadge.hidden = true;
    if (panel.countLabel) panel.countLabel.textContent = '';
  },
};
