// ============ 功能模块：课表查询 ============
// 自注册。渲染周视图课表：左侧大节时间轴 + 7 天课程卡片（CSS Grid），
// 课程可跨大节（如 14:00-16:35 跨第三、四大节）。

import { SECTION_START_TIMES, SECTION_END_TIMES } from '../config.js';
import { esc, fillSemesterSelect, fillWeekSelect } from '../ui.js';
import { iconCalendar } from '../icons.js';

let built = false;
let loaded = false;

const panel = { el: null, semester: null, week: null, grid: null, error: null, loading: null, queryBtn: null, result: null };

// 大节小节范围（与后端 SCHEDULE_SECTIONS 对应）：行跨 span
const SECTION_RANGES = [
  { start: 1, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 7 },
  { start: 8, end: 9 }, { start: 10, end: 12 },
];
const TOTAL_SECTIONS = 12;

/**
 * 从 weeks 字段解析节次范围，如 "1-16周[3-4节]" / "1-16周(3-4节)" / "3-4节" -> {start:3,end:4}。
 * 兼容方括号、圆括号、裸写三种格式。
 */
function parseCourseSections(weeksStr) {
  const m = (weeksStr || '').match(/(\d+(?:\s*[-~–]\s*\d+)*)\s*节/);
  if (!m) return null;
  const nums = m[1].split(/[-~–]/).map((n) => parseInt(n.trim(), 10)).filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

function formatCourseTime(courseSec) {
  if (!courseSec) return '';
  const start = SECTION_START_TIMES[courseSec.start];
  const end = SECTION_END_TIMES[courseSec.end];
  return start && end ? `${start}-${end}` : '';
}

function renderSchedule(schedule = {}) {
  const { sections = [], days = [], grid = [], notes = [] } = schedule;
  panel.grid.innerHTML = '';

  const notesRows = notes.length ? 1 : 0;
  panel.grid.style.gridTemplateRows = `32px repeat(${TOTAL_SECTIONS}, 60px)` + (notesRows ? ' auto' : '');

  // 表头行（节次 + 周一~周日）
  const corner = document.createElement('div');
  corner.className = 'sg-cell sg-header sg-corner'; corner.textContent = '节次';   // 左上角，行+列双向冻结
  panel.grid.appendChild(corner);
  days.forEach((d) => {
    const div = document.createElement('div');
    div.className = 'sg-cell sg-header'; div.textContent = d;
    panel.grid.appendChild(div);
  });

  // 大节标签（左侧，跨对应小节行）
  SECTION_RANGES.forEach((range, idx) => {
    const section = sections[idx] || {};
    const label = document.createElement('div');
    label.className = 'sg-cell sg-section';
    label.style.gridRow = `${range.start + 1} / ${range.end + 2}`;
    label.innerHTML = `${esc(section.name || '')}<span class="sg-time">${esc(section.time || '')}</span>`;
    panel.grid.appendChild(label);
  });

  // 空白背景格
  for (let s = 1; s <= TOTAL_SECTIONS; s++) {
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const cell = document.createElement('div');
      cell.className = 'sg-cell sg-blank';
      cell.style.gridRow = String(s + 1);
      cell.style.gridColumn = String(dIdx + 2);
      panel.grid.appendChild(cell);
    }
  }

  // 课程卡片
  grid.forEach((row, rowIdx) => {
    row.forEach((courses, dayIdx) => {
      if (!courses || !courses.length) return;
      courses.forEach((c) => {
        const courseSec = parseCourseSections(c.weeks);
        if (!courseSec) return;
        const div = document.createElement('div');
        div.className = 'schedule-course';
        div.style.gridRow = `${courseSec.start + 1} / ${courseSec.end + 2}`;
        div.style.gridColumn = String(dayIdx + 2);
        const time = formatCourseTime(courseSec);
        div.innerHTML =
          `<div class="course-name">${esc(c.name || '')}</div>` +
          (c.room ? `<div class="course-room">${esc(c.room)}</div>` : '') +
          (c.teacher ? `<div class="course-teacher">${esc(c.teacher)}</div>` : '') +
          (time ? `<div class="course-time">${esc(time)}</div>` : '');
        panel.grid.appendChild(div);
      });
    });
  });

  // 备注行（跨所有列）
  if (notesRows) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'sg-cell sg-notes';
    notesDiv.style.gridRow = String(TOTAL_SECTIONS + 2);
    notesDiv.style.gridColumn = '1 / -1';
    notesDiv.textContent = notes.join(' ');
    panel.grid.appendChild(notesDiv);
  }
}

async function query({ backend, store, ui, onSessionExpired }, firstLoad) {
  ui.hideError(panel.error);
  if (!backend) { ui.showError(panel.error, '会话已失效，请重新登录'); return; }
  // 首次加载：走 GET 默认页（服务器返回当前周，更准）；手动查询：用下拉选中的值 POST
  const semester = firstLoad ? null : (panel.semester.value || null);
  const week = firstLoad ? null : (panel.week.value ? parseInt(panel.week.value, 10) : null);

  ui.setLoading(panel.queryBtn, true);
  panel.loading.hidden = false;
  panel.result.hidden = true;
  try {
    const { schedule } = await backend.querySchedule(semester, week);
    renderSchedule(schedule);
    panel.result.hidden = false;
    // 首次加载后，用教务系统返回的默认值同步下拉框
    if (firstLoad) {
      if (schedule.defaultWeek != null) panel.week.value = String(schedule.defaultWeek);
      if (schedule.defaultSemester) panel.semester.value = schedule.defaultSemester;
    }
    loaded = true;
    store.saveScheduleCache(schedule);
  } catch (e) {
    ui.showError(panel.error, e.message);
    if (/(会话|登录)/.test(e.message)) onSessionExpired?.();
  } finally {
    ui.setLoading(panel.queryBtn, false);
    panel.loading.hidden = true;
  }
}

export default {
  id: 'schedule',
  label: '课表',
  icon: iconCalendar,
  type: 'panel',

  render({ el, backend, store, ui, onSessionExpired }) {
    el.innerHTML = `
      <div class="query-bar card">
        <div class="field"><label>学期</label>
          <select id="schedule-semester"><option value="">当前学期</option></select></div>
        <div class="field"><label>周次</label>
          <select id="schedule-week"><option value="">全部</option></select></div>
        <button class="btn btn-primary" id="schedule-query"><span class="btn-text">查询</span><span class="btn-spinner" hidden></span></button>
      </div>
      <div class="error-msg" id="schedule-error" hidden></div>
      <div class="loading" id="schedule-loading" hidden><div class="spinner"></div><p>正在查询...</p></div>
      <div class="card schedule-card" id="schedule-result" hidden>
        <div class="schedule-wrapper"><div class="schedule-grid" id="schedule-grid"></div></div>
      </div>`;

    panel.el = el;
    panel.semester = el.querySelector('#schedule-semester');
    panel.week = el.querySelector('#schedule-week');
    panel.grid = el.querySelector('#schedule-grid');
    panel.queryBtn = el.querySelector('#schedule-query');
    panel.error = el.querySelector('#schedule-error');
    panel.loading = el.querySelector('#schedule-loading');
    panel.result = el.querySelector('#schedule-result');
    fillWeekSelect(panel.week);
    panel.queryBtn.addEventListener('click', () => query({ backend, store, ui, onSessionExpired }, false));
    built = true;
  },

  setSemesters(semesters, defaultSem) {
    if (!panel.semester) return;
    fillSemesterSelect(panel.semester, semesters, '当前学期');
    if (defaultSem) panel.semester.value = defaultSem;
  },

  onActivate(ctx) {
    if (built && !loaded) query(ctx, true);   // 首次激活：GET 默认页
  },

  reset() { built = false; loaded = false; },
};
