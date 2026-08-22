// ============ 功能模块：奥兰系统 ============
// 点击 tab 经 CAS 单点登录跳转到奥兰（smst.hhu.edu.cn），无内嵌面板。
import { ORLAN_URL } from '../config.js';
import { iconPerson } from '../icons.js';

export default {
  id: 'orlan',
  label: '奥兰',
  icon: iconPerson,
  type: 'external',
  onActivate({ backend, ui }) {
    return backend.openOrlan(ORLAN_URL).catch((e) => ui.showToast(e.message));
  },
};
