import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGpaInfo, parseGrades, selectColumns, extractQueryForm, resolveSemester,
  parseSchedule, parseCourseSections, classifyGrade,
  extractCasTicket, parseZhjcQrResponse, parseZhjcUserInfo,
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
  assert.equal(info['平均成绩'], '86.0');
});

test('parseGrades 解析表头与数据行，selectColumns 挑出有效列', () => {
  const { headers, dataRows } = parseGrades(fixture('grade-list.html'), parse);
  assert.equal(headers.length, 8);
  assert.equal(dataRows.length, 3);

  const { headers: subH, rows: subR } = selectColumns(headers, dataRows);
  assert.deepEqual(subH, ['开课学期', '课程名称', '学分', '成绩', '绩点']);
  assert.equal(subR.length, 3);
  assert.equal(subR[0][1], '高等数学A');
  assert.equal(subR[0][4], '4.8');
});

test('extractQueryForm 取到默认学期与下拉选项', () => {
  const { fields, semesterOptions } = extractQueryForm(fixture('grade-query.html'), parse);
  assert.equal(fields.kksj, '2025-2026-1');
  assert.equal(semesterOptions.length, 4);
  assert.equal(semesterOptions[0].value, '2025-2026-1');
});

test('resolveSemester 支持 value/文本精确与模糊匹配', () => {
  const opts = [
    { value: '2025-2026-1', text: '2025-2026-1' },
    { value: '2024-2025-3', text: '2024-2025-3' },
  ];
  assert.equal(resolveSemester('2025-2026-1', opts), '2025-2026-1');
  assert.equal(resolveSemester('2024', opts), '2024-2025-3');
  assert.equal(resolveSemester('不存在', opts), null);
});

test('parseSchedule 解析课表 grid/notes/默认周与学期', () => {
  const sched = parseSchedule(fixture('schedule.html'), parse);
  assert.equal(sched.sections.length, 5);
  assert.deepEqual(sched.days, ['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
  assert.equal(sched.grid.length, 3);
  assert.equal(sched.defaultWeek, 5);
  assert.equal(sched.defaultSemester, '2025-2026-1');

  const mon = sched.grid[0][0];
  assert.equal(mon.length, 1);
  assert.equal(mon[0].name, '高等数学A');
  assert.equal(mon[0].teacher, '张三');
  assert.equal(mon[0].weeks, '1-16周(3-4节)');
  assert.equal(mon[0].room, '教1-101');
  assert.ok(sched.notes[0].includes('运动会'));
});

test('parseCourseSections 兼容方括号/圆括号/裸写/单节及大节回退', () => {
  assert.deepEqual(parseCourseSections('1-16周[3-4节]'), { start: 3, end: 4 });
  assert.deepEqual(parseCourseSections('1-16周(6-7节)'), { start: 6, end: 7 });
  assert.deepEqual(parseCourseSections('01-02节'), { start: 1, end: 2 });
  assert.deepEqual(parseCourseSections('1-8周[10节]'), { start: 10, end: 10 });
  assert.deepEqual(parseCourseSections('1-16周', 1), { start: 3, end: 5 });
});

test('classifyGrade 同时支持数字成绩与中文等级制成绩', () => {
  assert.equal(classifyGrade('95'), 'excellent');
  assert.equal(classifyGrade('86.5'), 'good');
  assert.equal(classifyGrade('81'), 'fair');
  assert.equal(classifyGrade('65'), 'pass');
  assert.equal(classifyGrade('52'), 'fail');
  assert.equal(classifyGrade('优秀'), 'excellent');
  assert.equal(classifyGrade('良好'), 'good');
  assert.equal(classifyGrade('中等'), 'fair');
  assert.equal(classifyGrade('及格'), 'pass');
  assert.equal(classifyGrade('通过'), 'pass');
  assert.equal(classifyGrade('不及格'), 'fail');
  assert.equal(classifyGrade('缺考'), 'fail');
});

test('extractCasTicket 从直接或 WebVPN 跳转地址中提取 ticket 与 state', () => {
  const t1 = extractCasTicket(
    'https://zhjc.hhu.edu.cn/mobile/?state=CAS_MOBILE_ACCESS-LOGIN/%23/pages/wxCas/index&ticket=ST-9988-abc',
  );
  assert.deepEqual(t1, { ticket: 'ST-9988-abc', state: 'CAS_MOBILE_ACCESS' });

  const t2 = extractCasTicket('https://zhjc.hhu.edu.cn/mobile/?ticket=ST-777');
  assert.deepEqual(t2, { ticket: 'ST-777', state: 'CAS_MOBILE_ACCESS' });

  assert.equal(extractCasTicket('https://authserver.hhu.edu.cn/authserver/login'), null);
});

test('parseZhjcQrResponse 与 parseZhjcUserInfo 正确解析通行码接口结构', () => {
  const qr = parseZhjcQrResponse({
    code: 0,
    data: { qrCodeContent: 'HHU-QR-123', qrCodeImage: 'iVBORw0K\r\nGgo=', expireTime: '1795680000000' },
  });
  assert.equal(qr.qrCodeContent, 'HHU-QR-123');
  assert.equal(qr.qrCodeImage, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(qr.expireTime, 1795680000000);

  const user = parseZhjcUserInfo({
    code: 0,
    data: { name: '林清河', shortDeptName: '计算机与软件学院', code: '20230001', photoFileId: 'f123' },
  });
  assert.equal(user.name, '林清河');
  assert.equal(user.dept, '计算机与软件学院');
  assert.equal(user.code, '20230001');
  assert.equal(user.photoFileId, 'f123');
});
