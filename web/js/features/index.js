// ============ 功能注册表（可插拔：加一个功能 = 加一个模块 + 在此登记一行） ============
// 每个模块都是自包含的：{ id, label, icon, type:'panel'|'external', render/onActivate, ... }。
// app.js 只遍历本数组生成 tab 与面板，不感知各功能内部实现。
// 新增功能步骤：在 features/ 新建 <name>.js（照抄 grades.js 或 classroom.js），
//   然后在下面数组加一行；主程序（app.js）无需改动。
import grades from './grades.js';
import schedule from './schedule.js';
import classroom from './classroom.js';
import orlan from './orlan.js';

export const features = [schedule, grades, classroom, orlan];
