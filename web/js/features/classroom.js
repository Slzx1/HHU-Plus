// ============ 功能模块：办事大厅 ============
// 点击 tab 直接跳转到办事大厅（WebVPN 内 taskcenter 首页），无内嵌面板。
// 轻量模块示例：新增一个「直接跳转外链」的 tab 只需照抄本文件、改 id/label/url。

import { CLASSROOM_URL } from '../config.js';
import { iconClassroom } from '../icons.js';

export default {
  id: 'classroom',
  label: '办事大厅',
  icon: iconClassroom,
  type: 'external',
  onActivate({ backend, ui }) {
    return backend.openClassroom(CLASSROOM_URL).catch((e) => ui.showToast(e.message));
  },
};
