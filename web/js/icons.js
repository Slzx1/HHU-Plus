// ============ 图标系统（统一线性风格 24x24 内联 SVG） ============
// 使用 currentColor 跟随主题色，视觉粗细一致（stroke-width 1.85）。

const strokeIcon = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// 课表：日历
export const iconCalendar = strokeIcon(
  '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
);

// 成绩：学业统计
export const iconGrades = strokeIcon(
  '<path d="M4 19.5h16"/><rect x="5.5" y="12" width="3" height="7.5" rx="0.8"/><rect x="10.5" y="7" width="3" height="12.5" rx="0.8"/><rect x="15.5" y="4.5" width="3" height="15" rx="0.8"/>',
);

// 通行码：二维码
export const iconQrCode = strokeIcon(
  '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M6.75 6.75h.01M17.25 6.75h.01M6.75 17.25h.01"/><path d="M14 14h2.5v2.5H14zM18.5 14h2M20.5 16.5V20.5H16.5M14 19v1.5"/>',
);

// 办事大厅：校园建筑
export const iconClassroom = strokeIcon(
  '<path d="M3 20.5h18"/><path d="M5 20.5V7l7-4 7 4v13.5"/><path d="M9.5 20.5v-5.5h5v5.5"/><path d="M9 10.5h.01M15 10.5h.01M12 10.5h.01"/>',
);

// 奥兰系统：学生服务
export const iconPerson = strokeIcon(
  '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20c.8-3.6 3.7-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
);

// 刷新
export const iconRefresh = strokeIcon(
  '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
);

// 搜索
export const iconSearch = strokeIcon(
  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
);

// 外部打开
export const iconExternal = strokeIcon(
  '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H11"/>',
);

// 太阳 / 月亮（主题切换）
export const iconSun = strokeIcon(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
);
export const iconMoon = strokeIcon(
  '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
);

// 退出登录
export const iconLogout = strokeIcon(
  '<path d="M10 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5H10"/><path d="m15.5 8.5 4 3.5-4 3.5"/><path d="M19.5 12H9.5"/>',
);

// 密码显示/隐藏
export const iconEye = strokeIcon(
  '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
);
export const iconEyeOff = strokeIcon(
  '<path d="M3 3l18 18"/><path d="M10.6 10.6a2.5 2.5 0 0 0 3.4 3.4"/><path d="M9.5 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.8 16.8 0 0 1-3.3 4.2"/><path d="M6.4 7.3A16.5 16.5 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.3 4.1-.9"/>',
);

// 左/右箭头
export const iconChevronLeft = strokeIcon('<path d="m15 18-6-6 6-6"/>');
export const iconChevronRight = strokeIcon('<path d="m9 18 6-6-6-6"/>');

// 盾牌/安全
export const iconShieldCheck = strokeIcon(
  '<path d="M12 3 5 6v5.5c0 4.6 3 8.2 7 9.5 4-1.3 7-4.9 7-9.5V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
);

// 关闭
export const iconClose = strokeIcon('<path d="M18 6 6 18M6 6l12 12"/>');
