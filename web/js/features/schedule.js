// ============ 功能模块：课表查询 ============
// 自注册。周视图双向冻结课表：
//   - 表头行（周一~周日）sticky top、节次列 sticky left、左上角 sticky both
//   - 同格多课程自动折叠为 +N 徽标，点击任意课程弹出完整详情抽屉
//   - 本地缓存秒开 + 后台同步，弱网/离线可读
//   - 首次激活 GET 默认当前周；手动切换学期/周次 POST 查询

import { SECTION_RANGES, SECTION_START_TIMES, SECTION_END_TIMES } from '../config.js';
import { parseCourseSections } from '../engine/parser.js';
import { esc, fillSemesterSelect, fillWeekSelect, formatSyncTime, openModal } from '../ui.js';
import { iconCalendar, iconChevronLeft, iconChevronRight, iconRefresh } from '../icons.js';

const TOTAL_SECTIONS = 12;
const COURSE_TONE_COUNT = 8;

let loaded = false;
let currentGetCtx = null;
let lastSchedule = null;

const panel = {
  el: null, semester: null, week: null, grid: null,
  error: null, loading: null, queryBtn: null, result: null,
  prevWeek: null, nextWeek: null, syncBadge: null, statsLine: null,
};

function courseToneIndex(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % COURSE_TONE_COUNT;
}

function formatCourseTime(courseSec) {
  if (!courseSec) return '';
  const start = SECTION_START_TIMES[courseSec.start];
  const end = SECTION_END_TIMES[courseSec.end];
  return start && end ? `${start}-${end}` : '';
}

function getTodayIndex() {
  const jsDay = new Date().getDay(); // 0=周日, 1=周一...6=周六
  return jsDay === 0 ? 6 : jsDay - 1;
}

function openCourseDetailModal(dayLabel, courseSec, courses) {
  const timeStr = formatCourseTime(courseSec);
  const sectionLabel = courseSec
    ? (courseSec.start === courseSec.end ? `第 ${courseSec.start} 节` : `第 ${courseSec.start}-${courseSec.end} 节`)
    : '';
  const bodyHtml = courses.map((c) => {
    const tone = courseToneIndex(c.name);
    return `
      <div class="course-detail-card course-tone-${tone}">
        <div class="cd-name">${esc(c.name || '未命名课程')}</div>
        <dl class="cd-meta">
          <div><dt>时间</dt><dd>${esc(dayLabel)} ${esc(sectionLabel)}${timeStr ? ` · ${esc(timeStr)}` : ''}</dd></div>
          ${c.room ? `<div><dt>教室</dt><dd>${esc(c.room)}</dd></div>` : ''}
          ${c.teacher ? `<div><dt>教师</dt><dd>${esc(c.teacher)}</dd></div>` : ''}
          ${c.weeks ? `<div><dt>周次</dt><dd>${esc(c.weeks)}</dd></div>` : ''}
        </dl>
      </div>`;
  }).join('');

  openModal({
    title: courses.length > 1 ? `同时段课程（共 ${courses.length} 门）` : '课程详情',
    bodyHtml,
  });
}

function renderSchedule(schedule = {}) {
  lastSchedule = schedule;
  const { sections = [], days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], grid = [], notes = [] } = schedule;
  panel.grid.innerHTML = '';

  const notesRows = notes.length ? 1 : 0;
  panel.grid.style.gridTemplateRows = `38px repeat(${TOTAL_SECTIONS}, 56px)` + (notesRows ? ' auto' : '');
  const todayIdx = getTodayIndex();

  // 1. 表头行（左上角双向冻结 + 周一~周日 sticky top）
  const corner = document.createElement('div');
  corner.className = 'sg-cell sg-header sg-corner';
  corner.textContent = '节次';
  panel.grid.appendChild(corner);

  days.forEach((d, idx) => {
    const div = document.createElement('div');
    div.className = 'sg-cell sg-header' + (idx === todayIdx ? ' is-today' : '');
    div.innerHTML = `<span>${esc(d)}</span>${idx === todayIdx ? '<span class="today-dot" aria-label="今天"></span>' : ''}`;
    panel.grid.appendChild(div);
  });

  // 2. 左侧大节时间轴（sticky left，跨对应小节行）
  SECTION_RANGES.forEach((range, idx) => {
    const section = sections[idx] || {};
    const label = document.createElement('div');
    label.className = 'sg-cell sg-section';
    label.style.gridRow = `${range.start + 1} / ${range.end + 2}`;
    const shortName = (section.name || `第${idx + 1}节`).replace('大节', '');
    label.innerHTML = `<span class="sg-sec-name">${esc(shortName)}</span><span class="sg-time">${esc((section.time || '').replace('-', '\n'))}</span>`;
    panel.grid.appendChild(label);
  });

  // 3. 空白背景格
  for (let s = 1; s <= TOTAL_SECTIONS; s++) {
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const cell = document.createElement('div');
      cell.className = 'sg-cell sg-blank' + (dIdx === todayIdx ? ' is-today-col' : '');
      cell.style.gridRow = String(s + 1);
      cell.style.gridColumn = String(dIdx + 2);
      panel.grid.appendChild(cell);
    }
  }

  // 4. 聚合同一时段的课程（修复多门重叠课程相互覆盖的 bug）
  const slotMap = new Map(); // key: "dayIdx:start:end" -> { dayIdx, courseSec, courses: [] }
  let totalCourseBlocks = 0;

  grid.forEach((row, rowIdx) => {
    if (!Array.isArray(row)) return;
    row.forEach((courses, dayIdx) => {
      if (!courses || !courses.length) return;
      courses.forEach((c) => {
        const courseSec = parseCourseSections(c.weeks, rowIdx);
        if (!courseSec) return;
        const key = `${dayIdx}:${courseSec.start}:${courseSec.end}`;
        if (!slotMap.has(key)) slotMap.set(key, { dayIdx, courseSec, courses: [] });
        slotMap.get(key).courses.push(c);
        totalCourseBlocks++;
      });
    });
  });

  for (const { dayIdx, courseSec, courses } of slotMap.values()) {
    const primary = courses[0];
    const tone = courseToneIndex(primary.name);
    const div = document.createElement('button');
    div.type = 'button';
    div.className = `schedule-course course-tone-${tone}`;
    div.style.gridRow = `${courseSec.start + 1} / ${courseSec.end + 2}`;
    div.style.gridColumn = String(dayIdx + 2);
    const time = formatCourseTime(courseSec);

    div.innerHTML =
      `<div class="course-name">${esc(primary.name || '')}</div>` +
      (primary.room ? `<div class="course-room">${esc(primary.room)}</div>` : '') +
      (primary.teacher ? `<div class="course-teacher">${esc(primary.teacher)}</div>` : '') +
      (time ? `<div class="course-time">${esc(time)}</div>` : '') +
      (courses.length > 1 ? `<span class="course-stack-badge">+${courses.length - 1}</span>` : '');

    div.addEventListener('click', () => openCourseDetailModal(days[dayIdx] || '', courseSec, courses));
    panel.grid.appendChild(div);
  }

  // 5. 备注行
  if (notesRows) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'sg-cell sg-notes';
    notesDiv.style.gridRow = String(TOTAL_SECTIONS + 2);
    notesDiv.style.gridColumn = '1 / -1';
    notesDiv.textContent = notes.join(' ');
    panel.grid.appendChild(notesDiv);
  }

  // 更新顶部统计摘要
  if (panel.statsLine) {
    const weekText = panel.week.value ? `第 ${panel.week.value} 周` : '全部周次';
    panel.statsLine.textContent = totalCourseBlocks
      ? `${weekText} · 共 ${totalCourseBlocks} 节课程 · 点击课程可查看详情`
      : `${weekText} · 本周暂无排课`;
  }
}

function updateSyncBadge(text, syncing = false) {
  if (!panel.syncBadge) return;
  panel.syncBadge.textContent = text;
  panel.syncBadge.classList.toggle('is-syncing', syncing);
  panel.syncBadge.hidden = !text;
}

function hydrateCache(store) {
  const cached = store.loadScheduleCache();
  if (!cached?.schedule) return false;
  if (cached.meta?.week && panel.week) panel.week.value = String(cached.meta.week);
  if (cached.meta?.semester && panel.semester) panel.semester.value = cached.meta.semester;
  renderSchedule(cached.schedule);
  panel.result.hidden = false;
  if (cached.updatedAt) updateSyncBadge(`已缓存 · ${formatSyncTime(cached.updatedAt)}`, false);
  return true;
}

async function query(ctx, firstLoad = false, { silent = false } = {}) {
  const { backend, store, ui, onSessionExpired } = ctx;
  ui.hideError(panel.error);
  if (!backend) { ui.showError(panel.error, '会话已失效，请重新登录'); return; }

  // 首次加载走 GET 默认页（服务器返回当前周，更准确）；手动查询用下拉值 POST
  const semester = firstLoad ? null : (panel.semester.value || null);
  const week = firstLoad ? null : (panel.week.value ? parseInt(panel.week.value, 10) : null);

  ui.setLoading(panel.queryBtn, true);
  if (!silent) {
    panel.loading.hidden = false;
    panel.result.hidden = true;
  } else {
    updateSyncBadge('正在同步最新课表…', true);
  }

  try {
    const { schedule } = await backend.querySchedule(semester, week);
    if (firstLoad) {
      if (schedule.defaultWeek != null) panel.week.value = String(schedule.defaultWeek);
      if (schedule.defaultSemester) panel.semester.value = schedule.defaultSemester;
    }
    renderSchedule(schedule);
    panel.result.hidden = false;
    loaded = true;
    store.saveScheduleCache(schedule, {
      semester: panel.semester.value || schedule.defaultSemester || '',
      week: panel.week.value || (schedule.defaultWeek != null ? String(schedule.defaultWeek) : ''),
    });
    updateSyncBadge('刚刚同步', false);
  } catch (e) {
    if (/(会话|登录|过期)/.test(e.message) || e.status === 401) {
      const recovered = await onSessionExpired?.();
      if (recovered) return query(currentGetCtx(), firstLoad, { silent });
    }
    ui.showError(panel.error, e.message);
    if (lastSchedule) {
      panel.result.hidden = false;
      updateSyncBadge('离线展示缓存', false);
    }
  } finally {
    ui.setLoading(panel.queryBtn, false);
    panel.loading.hidden = true;
  }
}

function stepWeek(delta) {
  if (!panel.week) return;
  const cur = parseInt(panel.week.value, 10);
  const next = Number.isNaN(cur) ? (delta > 0 ? 1 : 20) : Math.min(30, Math.max(1, cur + delta));
  if (String(next) === panel.week.value) return;
  panel.week.value = String(next);
  query(currentGetCtx(), false);
}

export default {
  id: 'schedule',
  label: '课表',
  title: '我的课表',
  icon: iconCalendar,
  type: 'panel',

  render({ el, getCtx }) {
    currentGetCtx = getCtx;
    el.innerHTML = `
      <div class="card toolbar-card">
        <div class="schedule-controls">
          <div class="field field-compact">
            <label for="schedule-semester">学期</label>
            <select id="schedule-semester"><option value="">当前学期</option></select>
          </div>
          <div class="field field-compact field-week">
            <label for="schedule-week">周次</label>
            <div class="week-stepper">
              <button type="button" class="icon-btn stepper-btn" id="schedule-prev-week" aria-label="上一周">${iconChevronLeft}</button>
              <select id="schedule-week"><option value="">全部周次</option></select>
              <button type="button" class="icon-btn stepper-btn" id="schedule-next-week" aria-label="下一周">${iconChevronRight}</button>
            </div>
          </div>
          <button type="button" class="btn btn-primary toolbar-btn" id="schedule-query">
            <span class="btn-icon">${iconRefresh}</span>
            <span class="btn-text">同步</span>
            <span class="btn-spinner" hidden></span>
          </button>
        </div>
        <div class="toolbar-meta">
          <span class="meta-text" id="schedule-stats"></span>
          <span class="sync-pill" id="schedule-sync" hidden></span>
        </div>
      </div>

      <div class="error-msg" id="schedule-error" hidden></div>
      <div class="loading" id="schedule-loading" hidden><div class="spinner"></div><p>正在获取课表…</p></div>

      <div class="card schedule-card" id="schedule-result" hidden>
        <div class="schedule-wrapper"><div class="schedule-grid" id="schedule-grid"></div></div>
      </div>`;

    panel.el = el;
    panel.semester = el.querySelector('#schedule-semester');
    panel.week = el.querySelector('#schedule-week');
    panel.grid = el.querySelector('#schedule-grid');
    panel.queryBtn = el.querySelector('#schedule-query');
    panel.prevWeek = el.querySelector('#schedule-prev-week');
    panel.nextWeek = el.querySelector('#schedule-next-week');
    panel.error = el.querySelector('#schedule-error');
    panel.loading = el.querySelector('#schedule-loading');
    panel.result = el.querySelector('#schedule-result');
    panel.syncBadge = el.querySelector('#schedule-sync');
    panel.statsLine = el.querySelector('#schedule-stats');

    fillWeekSelect(panel.week);
    panel.queryBtn.addEventListener('click', () => query(currentGetCtx(), false));
    panel.prevWeek.addEventListener('click', () => stepWeek(-1));
    panel.nextWeek.addEventListener('click', () => stepWeek(1));
    panel.semester.addEventListener('change', () => query(currentGetCtx(), false));
    panel.week.addEventListener('change', () => query(currentGetCtx(), false));
  },

  setSemesters(semesters, defaultSem) {
    if (!panel.semester) return;
    fillSemesterSelect(panel.semester, semesters, '当前学期');
    if (defaultSem) panel.semester.value = defaultSem;
  },

  onActivate(ctx) {
    if (!loaded) {
      const hasCache = hydrateCache(ctx.store);
      query(ctx, true, { silent: hasCache });
    }
  },

  reset() {
    // 修复原 bug：DOM 面板仍在文档中，切勿重置 built；只清除已加载状态与展示内容
    loaded = false;
    lastSchedule = null;
    if (panel.grid) panel.grid.innerHTML = '';
    if (panel.result) panel.result.hidden = true;
    if (panel.error) { panel.error.hidden = true; panel.error.textContent = ''; }
    if (panel.syncBadge) panel.syncBadge.hidden = true;
    if (panel.statsLine) panel.statsLine.textContent = '';
  },
};
