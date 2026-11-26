// ============ 功能注册表（可插拔：加一个功能 = 加一个模块 + 在此登记一行） ============
// app.js 遍历本数组自动生成移动端底部导航、桌面端左侧导航栏与内容面板。
import schedule from './schedule.js';
import grades from './grades.js';
import passcode from './passcode.js';
import classroom from './classroom.js';
import orlan from './orlan.js';

export const features = [schedule, grades, passcode, classroom, orlan];
