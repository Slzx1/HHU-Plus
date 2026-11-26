// ============ 全局配置（唯一来源） ============
// 本文件是 HHU+ 所有环境（APK / Web / CLI）共用的唯一常量源。
// 改学校域名、接口 URL、超时、节流等，只在这里改，不要散落各处。
//
// 纯 ES module（不 import 任何 Node 专属模块），浏览器 / APK / Node server / CLI 共用。

// ---- 基本网络 ----
export const WEBVPN_BASE = 'https://webvpn.hhu.edu.cn';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export const REQUEST_TIMEOUT = 30_000;      // 单次请求超时(毫秒)
export const MAX_RETRIES = 3;               // 网络错误重试次数
export const FETCH_REFETCH_DELAY = 500;     // 重试退避基础延迟(毫秒)

// ---- WebVPN 编码后的内网 host ----
// 这些十六进制串是 WebVPN 对校内各 host 的编码，由学校网关决定。
// 若要新增一个校内系统，按同样格式在 INTERNAL_HOST_MAP 补一条即可。
export const HOST_CAS         = '77726476706e69737468656265737421f1e2559434357a467b1ac7a490406d301894467e2b'; // authserver.hhu.edu.cn
export const HOST_OLD_PORTAL  = '77726476706e69737468656265737421fdee0f942f2526557a1dc7af96';               // portal.hhu.edu.cn
export const HOST_INFO_PORTAL = '77726476706e69737468656265737421fdee4f99307e60586b468ca88d1b203b';         // my.hhu.edu.cn
export const HOST_JXSD        = '77726476706e69737468656265737421fae0598869386045300d8db9d6562d';           // jwxt.hhu.edu.cn
export const HOST_TASKCENTER  = '77726476706e69737468656265737421fdee499d2b3c2658761dc7a99c406d3615';       // myhall.hhu.edu.cn
export const HOST_SMST        = '77726476706e69737468656265737421e3fa528869386045300d8db9d6562d';           // smst.hhu.edu.cn

/** 内网 host -> WebVPN 编码 host。重写 URL 时用。 */
export const INTERNAL_HOST_MAP = {
  'authserver.hhu.edu.cn': HOST_CAS,
  'jwxt.hhu.edu.cn': HOST_JXSD,
  'portal.hhu.edu.cn': HOST_OLD_PORTAL,
  'my.hhu.edu.cn': HOST_INFO_PORTAL,
  'myhall.hhu.edu.cn': HOST_TASKCENTER,
  'smst.hhu.edu.cn': HOST_SMST,
};

// ---- 登录 / 导航 ----
export const CAS_LOGIN_URL =
  `${WEBVPN_BASE}/https/${HOST_CAS}/authserver/login` +
  `?service=https%3A%2F%2Fwebvpn.hhu.edu.cn%2Flogin%3Fcas_login%3Dtrue`;

/** 登录后依次访问的导航链路，用于建立完整教务系统会话。 */
export const NAV_URLS = [
  `${WEBVPN_BASE}/`,
  `${WEBVPN_BASE}/https/${HOST_INFO_PORTAL}/#/students`,
  `${WEBVPN_BASE}/https/${HOST_OLD_PORTAL}/portal-web/guest/hhdx/index.html`,
  `${WEBVPN_BASE}/https/${HOST_OLD_PORTAL}/portal-web/html/index.html`,
  `${WEBVPN_BASE}/https/${HOST_JXSD}/jsxsd/framework/xsMain_hehdx.htmlx`,
];

// ---- 成绩查询 ----
export const GRADE_QUERY_URL = `${WEBVPN_BASE}/https/${HOST_JXSD}/jsxsd/kscj/cjcx_query`; // 表单页(含 kksj 下拉)
export const GRADE_LIST_URL  = `${WEBVPN_BASE}/https/${HOST_JXSD}/jsxsd/kscj/cjcx_list`;  // 结果列表页
export const DATA_LIST_TABLE_ID = 'dataList';  // 成绩表格 id
export const KKSJ_FIELD = 'kksj';              // 学期下拉框字段名

/** 成绩表保留列：(关键字, 排除词)。用于从抓到的全量列里挑出有意义的列。 */
export const WANTED_COLUMNS = [
  ['开课学期', []],
  ['课程名称', ['代码', '性质', '属性']],
  ['学分', []],
  ['成绩', ['性质', '标识']],
  ['绩点', []],
];

// ---- 课表 ----
export const SCHEDULE_URL = `${WEBVPN_BASE}/https/${HOST_JXSD}/jsxsd/xskb/xskb_list.do`;
export const SCHEDULE_TABLE_ID = 'timetable';

/** 课表大节信息（左侧时间轴用，固定）。 */
export const SCHEDULE_SECTIONS = [
  { name: '第一大节', time: '08:00-09:35', periods: '1-2小节' },
  { name: '第二大节', time: '09:50-12:15', periods: '3-5小节' },
  { name: '第三大节', time: '14:00-15:35', periods: '6-7小节' },
  { name: '第四大节', time: '15:50-17:25', periods: '8-9小节' },
  { name: '第五大节', time: '18:30-20:55', periods: '10-12小节' },
];

/** 大节对应的小节起止范围（1-indexed）。 */
export const SECTION_RANGES = [
  { start: 1, end: 2 },
  { start: 3, end: 5 },
  { start: 6, end: 7 },
  { start: 8, end: 9 },
  { start: 10, end: 12 },
];

/** 每小节开始时间与结束时间。小节第 1~12 节 -> 时分。 */
export const SECTION_START_TIMES = {
  1: '08:00', 2: '08:50', 3: '09:50', 4: '10:40', 5: '11:30',
  6: '14:00', 7: '14:50', 8: '15:50', 9: '16:40',
  10: '18:30', 11: '19:20', 12: '20:10',
};
export const SECTION_END_TIMES = {
  1: '08:45', 2: '09:35', 3: '10:35', 4: '11:25', 5: '12:15',
  6: '14:45', 7: '15:35', 8: '16:35', 9: '17:25',
  10: '19:15', 11: '20:05', 12: '20:55',
};

// ---- 办事大厅 / 奥兰系统 ----
export const CLASSROOM_URL =
  `${WEBVPN_BASE}/https/${HOST_TASKCENTER}/taskcenter/home`;

/** 奥兰系统：先走 CAS 票据握手（ORLAN_URL），握手完成后直达已登录主页（ORLAN_HOME_URL），绕过奥兰 login.aspx 死循环。 */
export const ORLAN_URL =
  `${WEBVPN_BASE}/https/${HOST_CAS}/authserver/login?service=https%3A%2F%2Fsmst.hhu.edu.cn%2Fdefault.aspx`;
export const ORLAN_HOME_URL =
  `${WEBVPN_BASE}/https/${HOST_SMST}/default.aspx`;

// ---- 智慧通行码（河海大学统一智慧泛门禁系统 zhjc.hhu.edu.cn） ----
// 原微信 H5 入口：https://zhjc.hhu.edu.cn/#/pages/wxFrontPage/index
// 登录原理：复用已有 WebVPN CAS 会话向 authserver 申请 zhjc 的 Service Ticket，
//          再调用 /admin/oauth2/token 换取 Bearer access_token，全程免重登、免微信。
export const ZHJC_BASE = 'https://zhjc.hhu.edu.cn';
export const ZHJC_FRONT_URL = `${ZHJC_BASE}/#/pages/wxFrontPage/index`;
export const ZHJC_SERVICE_URL =
  `${ZHJC_BASE}/mobile/?state=CAS_MOBILE_ACCESS-LOGIN/%23/pages/wxCas/index`;
export const ZHJC_CAS_URL =
  `${WEBVPN_BASE}/https/${HOST_CAS}/authserver/login?service=${ZHJC_SERVICE_URL}`;
export const ZHJC_OAUTH_TOKEN_URL = `${ZHJC_BASE}/admin/oauth2/token`;
export const ZHJC_BASIC_AUTH = 'Basic c29jaWFsOnNvY2lhbA==';
export const ZHJC_USER_INFO_URL = `${ZHJC_BASE}/admin/accessPerson/mobile/loginUserBaseInfo`;
export const ZHJC_QR_CODE_URL = `${ZHJC_BASE}/admin/accessPerson/mobile/freshAccessQrCode`;
export const ZHJC_PHOTO_URL = `${ZHJC_BASE}/admin/sys-file/local/getFileById`;

// ---- APK Cookie 持久化需要同步的 URL 列表（含路径级 cookie 如 CASTGC） ----
export const APK_COOKIE_URLS = [
  { key: 'webvpn',     url: `${WEBVPN_BASE}/`,                                    path: '/' },
  { key: 'cas',        url: `${WEBVPN_BASE}/https/${HOST_CAS}/authserver/`,       path: `/https/${HOST_CAS}/authserver` },
  { key: 'jwxt',       url: `${WEBVPN_BASE}/https/${HOST_JXSD}/jsxsd/`,           path: `/https/${HOST_JXSD}/jsxsd` },
  { key: 'taskcenter', url: `${WEBVPN_BASE}/https/${HOST_TASKCENTER}/taskcenter/`, path: `/https/${HOST_TASKCENTER}/taskcenter` },
  { key: 'smstVpn',    url: `${WEBVPN_BASE}/https/${HOST_SMST}/`,                 path: `/https/${HOST_SMST}` },
  { key: 'smst',       url: 'https://smst.hhu.edu.cn/',                           path: '/' },
  { key: 'authserver', url: 'https://authserver.hhu.edu.cn/authserver/',          path: '/authserver' },
  { key: 'zhjc',       url: `${ZHJC_BASE}/`,                                      path: '/' },
];

// ---- 登录 / 会话策略 ----
export const LOGIN_THROTTLE_MS = 30 * 60 * 1000;   // 30 分钟内不重复自动登录(防风控)
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;  // 服务端滑动会话有效期(Web 模式 2 小时)

// ---- 密码加密 ----
/** AES-CBC 加密字符集（与学校 encrypt.js 一致，排除易混淆字符）。 */
export const ENCRYPT_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

// ---- 成绩梯度分级 ----
/** 数值成绩梯度阈值：>=90 优秀 / 85-89 良好 / 80-84 中等 / 60-79 及格 / <60 不及格。 */
export const GRADE_LEVELS = [
  { min: 90, key: 'excellent', label: '优秀' },
  { min: 85, key: 'good',      label: '良好' },
  { min: 80, key: 'fair',      label: '中等' },
  { min: 60, key: 'pass',      label: '及格' },
  { min: 0,  key: 'fail',      label: '不及格' },
];
