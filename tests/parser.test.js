import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGpaInfo, parseGrades, selectColumns, extractQueryForm, resolveSemester,
  parseSchedule,
} from '../web/js/engine/parser.js';
import { fixture, parse } from './helpers.js';

test('parseGpaInfo 提取 GPA 统计', () => {
  const info = parseGpaInfo(fixture('grade-list.html'));
  assert.equal(info['学位绩点'], '4.67');
  assert.equal(info['平均学分绩点'], '4.67');
  assert.equal(info['平均成绩'], '88.25');
  assert.equal(info['所修门数'], '24');
  assert.equal(info['所修总学分'], '44.5');
  assert.equal(info['专业排名'], '3');
  assert.equal(info['统计时间'], '2025-07-10 12:00:00');
});

// 回归：GPA 块用嵌套 <font>/<div> 结构（标签不带空格分隔）时也能提取到。
// 旧实现依赖 doc.body.textContent，而 linkedom 对这类结构返回空串导致失败。
test('parseGpaInfo 对嵌套标签结构仍能提取', () => {
  const html = `
    <div class="info"><font>学位绩点:</font><font>4.48</font></div>
    <div class="info"><font>平均学分绩点:</font><font>4.39</font></div>
    <div class="info"><font>平均成绩:</font><font>86.82</font></div>
    <div class="info"><font>所修门数:</font><font>50</font></div>
    <div class="info"><font>所修总学分:</font><font>100.5</font></div>
    <div class="info"><font>专业排名:</font><font>3</font></div>`;
  const info = parseGpaInfo(html);
  assert.equal(info['学位绩点'], '4.48');
  assert.equal(info['平均学分绩点'], '4.39');
  assert.equal(info['平均成绩'], '86.82');
  assert.equal(info['所修门数'], '50');
  assert.equal(info['所修总学分'], '100.5');
  assert.equal(info['专业排名'], '3');
});

test('parseGpaInfo 忽略 script/style 干扰', () => {
  const html = '<script>var x="平均成绩:99";</script><div><font>平均成绩:</font><font>86.0</font></div>';
  const info = parseGpaInfo(html);
  assert.equal(info['平均成绩'], '86.0');   // 不应被 script 里的 99 干扰
});

test('parseGrades 解析表头与数据行，selectColumns 挑出有效列', () => {
  const { headers, dataRows } = parseGrades(fixture('grade-list.html'), parse);
  assert.equal(headers.length, 8);
  assert.equal(dataRows.length, 3);

  const { headers: subH, rows: subR } = selectColumns(headers, dataRows);
  // 清晰命中所需列，排除 课程代码/课程性质/成绩性质
  assert.deepEqual(subH, ['开课学期', '课程名称', '学分', '成绩', '绩点']);
  assert.equal(subR.length, 3);
  assert.equal(subR[0][1], '高等数学A');
  assert.equal(subR[0][4], '4.8');
});

test('extractQueryForm 取到默认学期与下拉选项', () => {
  const { fields, semesterOptions } = extractQueryForm(fixture('grade-query.html'), parse);
  assert.equal(fields.kksj, '2025-2026-1');       // 有 selected 属性
  assert.equal(semesterOptions.length, 4);
  assert.equal(semesterOptions[0].value, '2025-2026-1');
  assert.equal(semesterOptions[0].text, '2025-2026-1');
});

test('resolveSemester 支持 value/文本精确与模糊匹配', () => {
  const opts = [
    { value: '2025-2026-1', text: '2025-2026-1' },
    { value: '2024-2025-3', text: '2024-2025-3' },
  ];
  assert.equal(resolveSemester('2025-2026-1', opts), '2025-2026-1'); // value 精确
  assert.equal(resolveSemester('2025-2026-1', opts), '2025-2026-1'); // 文本精确
  assert.equal(resolveSemester('2024', opts), '2024-2025-3');        // 模糊
  assert.equal(resolveSemester('不存在', opts), null);
});

test('parseSchedule 解析课表 grid/notes/默认周与学期', () => {
  const sched = parseSchedule(fixture('schedule.html'), parse);
  assert.equal(sched.sections.length, 5);          // 大节固定 5 段
  assert.deepEqual(sched.days, ['周一','周二','周三','周四','周五','周六','周日']);
  assert.equal(sched.grid.length, 3);              // 3 个数据行（第2/3/4个大节）
  assert.equal(sched.defaultWeek, 5);
  assert.equal(sched.defaultSemester, '2025-2026-1');

  // 周一第一大节的课程
  const mon = sched.grid[0][0];
  assert.equal(mon.length, 1);
  assert.equal(mon[0].name, '高等数学A');
  assert.equal(mon[0].teacher, '张三');
  assert.equal(mon[0].weeks, '1-16周(3-4节)');
  assert.equal(mon[0].room, '教1-101');

  // 周四第二大节
  const thu = sched.grid[1][3];
  assert.equal(thu[0].name, '大学物理(下)');
  // 备注行
  assert.equal(sched.notes.length, 1);
  assert.ok(sched.notes[0].includes('运动会'));
});
