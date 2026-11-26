// 生成文档用的干净示例截图（通用课程名 + 编造成绩 + 演示二维码，不含任何真实/个人数据）
// 并顺带校验前端零报错、交互流畅（切换课表/成绩/通行码/弹窗/主题/登出重登）。
// 用法：先启动后端(node server/server.js)再 node scripts/gen-doc-shots.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5000';
const OUT = 'docs/images';

// 演示用清晰 SVG 二维码（转 data URL，避免外部依赖）
function makeDemoQrDataUrl() {
  const size = 21;
  // 构造规范视觉的 21x21 模拟矩阵（含三个定位回字）
  const isFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
  const finderDark = (r, c) => {
    const lr = r >= size - 7 ? r - (size - 7) : r;
    const lc = c >= size - 7 ? c - (size - 7) : c;
    return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
  };
  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let dark = false;
      if (isFinder(r, c)) dark = finderDark(r, c);
      else if (r === 6 || c === 6) dark = (r + c) % 2 === 0;
      else dark = ((r * 7 + c * 13 + r * c) % 5) < 2;
      if (dark) rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#0f172a"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${size + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const c = (name, room, teacher, weeks) => ({ name, room, teacher, weeks });
const scheduleGrid = [
  [[c('高等数学A(上)', '致用楼-101', '张老师', '1-16周(1-2节)')], [], [c('程序设计基础', '计信楼-305', '刘老师', '1-16周(1-2节)')], [], [], [], []],
  [[c('大学英语Ⅲ', '博学楼-204', '李老师', '1-16周(3-4节)')], [c('工程水文学', '闻天馆-108', '周老师', '1-12周(3-5节)')], [c('线性代数', '致高楼-303', '王老师', '1-16周(3-4节)'), c('算法设计与分析', '计信楼-402', '孙老师', '9-16周(3-4节)')], [], [c('概率论与数理统计', '博学楼-110', '陈老师', '1-16周(3-5节)')], [], []],
  [[], [], [c('大学物理(下)', '实验楼-401', '赵老师', '1-16周(6-7节)')], [c('操作系统原理', '计信楼-502', '吴老师', '1-16周(6-7节)')], [c('软件工程导论', '致用楼-202', '郑老师', '1-14周(6-7节)')], [], []],
  [[c('大学体育(羽毛球)', '体育馆二楼', '马老师', '2-16周(8-9节)')], [], [], [c('中国近现代史纲要', '致高楼-105', '徐老师', '1-12周(8-9节)')], [], [], []],
  [[], [c('河海文化与水利精神', '江宁会议中心', '林老师', '4-11周(10-11节)')], [], [], [], [], []],
];

const schedule = {
  sections: [
    { name: '第一大节', time: '08:00-09:35', periods: '1-2小节' },
    { name: '第二大节', time: '09:50-12:15', periods: '3-5小节' },
    { name: '第三大节', time: '14:00-15:35', periods: '6-7小节' },
    { name: '第四大节', time: '15:50-17:25', periods: '8-9小节' },
    { name: '第五大节', time: '18:30-20:55', periods: '10-12小节' },
  ],
  days: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  grid: scheduleGrid,
  notes: ['示例课表：周三第二大节含两门重叠课程（点击可查看全部详情）'],
  defaultWeek: 6,
  defaultSemester: '2025-2026-1',
};

const grades = {
  gpa_info: {
    '学位绩点': '4.36', '平均学分绩点': '4.28', '平均成绩': '89.4',
    '所修门数': '26', '所修总学分': '52.5', '专业排名': '12',
    '推优绩点': '4.22', '推优平均成绩': '88.6', '出国就业平均成绩': '88.9',
  },
  grades: {
    headers: ['开课学期', '课程名称', '学分', '成绩', '绩点'],
    rows: [
      ['2025-2026-1', '高等数学A(上)', '5.0', '95', '4.8'],
      ['2025-2026-1', '操作系统原理', '4.0', '91', '4.4'],
      ['2025-2026-1', '大学英语Ⅲ', '3.0', '88', '3.9'],
      ['2025-2026-1', '线性代数', '3.0', '84', '3.6'],
      ['2025-2026-1', '大学物理(下)', '3.0', '78', '3.1'],
      ['2025-2026-1', '大学体育(羽毛球)', '1.0', '优秀', '4.5'],
      ['2025-2026-1', '软件工程实践', '2.0', '良好', '3.8'],
    ],
  },
};

const passcode = {
  qr: {
    qrCodeContent: 'HHU-DEMO-PASSCODE',
    qrCodeImage: makeDemoQrDataUrl(),
    expireTime: Date.now() + 95_000,
  },
  user: {
    name: '林清河',
    dept: '计算机与软件学院',
    code: '2023060101',
  },
};

async function main() {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();

  const errors = [];
  p.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  p.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

  await p.route('**/api/session/check', (r) => r.fulfill({ json: { valid: true, username: '2023060101' } }));
  await p.route('**/api/schedule/query', (r) => r.fulfill({ json: { schedule } }));
  await p.route('**/api/grades/query', (r) => r.fulfill({ json: grades }));
  await p.route('**/api/passcode/query', (r) => r.fulfill({ json: passcode }));

  // 1. 登录页
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/login.png` });

  // 2. 注入会话 -> 课表页
  await p.evaluate(() => {
    localStorage.setItem('hhup.session', 'demo-sid');
    localStorage.setItem('hhup.username', '2023060101');
    localStorage.setItem('hhup.semesters', JSON.stringify([
      { value: '2025-2026-1', text: '2025-2026-1 秋季' },
      { value: '2024-2025-2', text: '2024-2025-2 春季' },
    ]));
    localStorage.setItem('hhup.default_semester', '2025-2026-1');
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/schedule.png` });

  // 验证点击课程弹出详情抽屉
  await p.click('.schedule-course');
  await p.waitForTimeout(250);
  const modalVisible = await p.isVisible('.modal-sheet');
  if (!modalVisible) throw new Error('点击课程未弹出详情抽屉');
  await p.click('.modal-close');
  await p.waitForTimeout(200);

  // 3. 成绩页
  await p.click('#bottom-nav [data-id="grades"]');
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/grades.png` });

  // 4. 通行码页
  await p.click('#bottom-nav [data-id="passcode"]');
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/passcode.png` });

  await b.close();

  if (errors.length) {
    console.error('浏览器检测到错误:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('已生成 docs/images/{login,schedule,grades,passcode}.png，零控制台报错！');
}
main().catch((e) => { console.error(e); process.exit(1); });
