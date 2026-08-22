// ============ 图标（Material 风格，24px 内联 SVG） ============
// 用 fill:currentColor 跟随文本颜色；由底部导航的 .tab 渲染。
// 若想换图标，改这里的 path 即可（各 feature 通过 config/features 引用）。

const svg = (path) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

// 课表：日历
export const iconCalendar = svg(
  'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z',
);
// 成绩：柱状图（assessment）
export const iconGrades = svg(
  'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
);
// 办事大厅：楼宇（business）
export const iconClassroom = svg(
  'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
);
// 奥兰系统：人
export const iconPerson = svg(
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
);
