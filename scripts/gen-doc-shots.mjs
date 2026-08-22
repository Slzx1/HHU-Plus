// 生成文档用的干净示例截图（通用课程名 + 编造成绩，不含任何个人/真实数据）
// 输出到 docs/images/。用法：先启动后端(node server/server.js)再 node scripts/gen-doc-shots.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5000';
const OUT = 'docs/images';

// ---- 示例数据（纯演示，勿含真实信息） ----
const c = (name, room, teacher, weeks) => [{ name, room, teacher, weeks }];
const scheduleGrid = [
  [c('高等数学', '教1-101', '张老师', '1-16周(1-2节)'), [],[],[],[],[],[]],
  [c('大学英语', '外语楼-201', '李老师', '1-16周(3-5节)'), [], c('线性代数', '教2-303', '王老师', '1-16周(3-5节)'), [],[],[],[]],
  [[],[], c('大学物理', '实验楼-401', '赵老师', '1-16周(6-7节)'), [], c('程序设计基础', '机房-502', '刘老师', '1-9周(6-7节)'), [],[]],
  [c('体育', '操场', '陈老师', '2-16周(8-9节)'), [],[],[],[],[],[]],
  [[],[],[],[],[],[],[]],
];
const schedule = {
  sections: [
    { name: '第一大节', time: '08:00-09:35', periods: '1-2小节' },
    { name: '第二大节', time: '09:50-12:15', periods: '3-5小节' },
    { name: '第三大节', time: '14:00-15:35', periods: '6-7小节' },
    { name: '第四大节', time: '15:50-17:25', periods: '8-9小节' },
    { name: '第五大节', time: '18:30-20:55', periods: '10-12小节' },
  ],
  days: ['周一','周二','周三','周四','周五','周六','周日'],
  grid: scheduleGrid, notes: ['示例：仅演示布局'], defaultWeek: 5, defaultSemester: '2025-2026-1',
};
const grades = {
  gpa_info: {
    '学位绩点': '4.20', '平均学分绩点': '4.10', '平均成绩': '88.0',
    '所修门数': '20', '所修总学分': '40.0', '专业排名': '18',
    '推优绩点': '4.05', '推优平均成绩': '87.0', '出国就业平均成绩': '86.0',
  },
  grades: {
    headers: ['开课学期','课程名称','学分','成绩','绩点'],
    rows: [
      ['2025-2026-1', '高等数学', '5.0', '95', '4.8'],
      ['2025-2026-1', '大学英语', '3.0', '88', '3.9'],
      ['2025-2026-1', '线性代数', '3.0', '82', '3.5'],
      ['2025-2026-1', '大学物理', '3.0', '74', '3.0'],
      ['2025-2026-1', '程序设计基础', '4.0', '68', '2.5'],
      ['2025-2026-1', '体育', '2.0', '90', '4.0'],
    ],
  },
};

async function main() {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  await p.route('**/api/schedule/query', (r) => r.fulfill({ json: { schedule } }));
  await p.route('**/api/grades/query', (r) => r.fulfill({ json: grades }));

  // 登录页
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${OUT}/login.png` });

  // 主界面（注入会话）
  await p.evaluate(() => {
    localStorage.setItem('hhup.session', 'demo');
    localStorage.setItem('hhup.semesters', JSON.stringify([{ value:'2025-2026-1', text:'2025-2026-1 秋' }]));
    localStorage.setItem('hhup.default_semester', '2025-2026-1');
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/schedule.png` });

  await p.click('[data-id="grades"]');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.scrollTo(0, 260));   // 露出成绩卡片列表
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/grades.png` });

  await b.close();
  console.log('已生成 docs/images/{login,schedule,grades}.png');
}
main().catch((e) => { console.error(e); process.exit(1); });
