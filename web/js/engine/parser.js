// ============ 核心解析层（纯函数，可单测） ============
// 不含网络请求、不依赖全局 DOM，只做「HTML/JSON/URL -> 结构化数据」与 AES 加密。
// 需要 DOM 的函数接收注入的 `parse` 工厂（浏览器用 DOMParser，Node 用 linkedom）。

import {
  ENCRYPT_CHARS, WANTED_COLUMNS, SCHEDULE_SECTIONS, SECTION_RANGES,
  SCHEDULE_TABLE_ID, DATA_LIST_TABLE_ID, KKSJ_FIELD, GRADE_LEVELS,
} from '../config.js';

// ---- GPA 文本块各指标正则 ----
const GPA_PATTERNS = {
  '学位绩点': /学位绩点[:：]\s*([\d.?]+)/,
  '出国就业平均成绩': /出国就业平均成绩[:：]\s*([\d.]+)/,
  '推优绩点': /推优绩点[:：]\s*([\d.?]+)/,
  '专业排名': /专业排名[:：]\s*(\d+)/,
  '推优平均成绩': /推优平均成绩[:：]\s*([\d.]+)/,
  '统计时间': /统计时间[:：]\s*([\d\-: ]+)/,
  '所修门数': /所修门数[:：]\s*(\d+)/,
  '所修总学分': /所修总学分[:：]\s*([\d.]+)/,
  '平均学分绩点': /平均学分绩点[:：]\s*([\d.?]+)/,
  '平均成绩': /平均成绩[:：]\s*([\d.]+)/,
};

// ---- AES-CBC 加密 ----
/** 生成随机串。测试时可注入确定性 rng 以验证已知答案。 */
function defaultRng(length) {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += ENCRYPT_CHARS[Math.floor(Math.random() * ENCRYPT_CHARS.length)];
  }
  return s;
}

/** Uint8Array -> base64。分块避免大数组 apply 栈溢出。 */
export function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * AES-CBC 加密密码（与学校 encrypt.js 一致：64 字符随机前缀 + 密码）。
 * 明文 = 随机前缀(64) + 密码；key = salt；IV = 16 字符随机串（不随密文传输）。
 */
export async function encryptPassword(password, salt, rng = defaultRng) {
  if (!salt) return password;
  const plaintext = rng(64) + password;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(salt),
    { name: 'AES-CBC' }, false, ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(rng(16)) },
    key, new TextEncoder().encode(plaintext),
  );
  return uint8ToBase64(new Uint8Array(cipher));
}

// ---- 通用文本 / DOM 工具 ----
function textOf(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }

/**
 * 从原始 HTML 提取纯文本（剥掉所有标签 + 解码常见 HTML 实体 + 压空白）。
 * 必须使用剥标签实现而非 DOM textContent：linkedom 对嵌套 `<font>` 等结构会返回空串。
 */
export function stripHtmlText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- GPA 解析 ----
/** 从成绩列表页解析 GPA 文本块，返回 { 指标名: 值 }。 */
export function parseGpaInfo(html) {
  const text = stripHtmlText(html);
  const info = {};
  for (const [key, regex] of Object.entries(GPA_PATTERNS)) {
    const m = text.match(regex);
    if (m) info[key] = m[1].trim();
  }
  return info;
}

// ---- 成绩分级（同时支持数字成绩与中文等级成绩） ----
const TEXT_GRADE_MAP = [
  [/优秀|优|A\+?|免修/i, 'excellent'],
  [/良好|良|B\+?/i, 'good'],
  [/中等|中|C\+?/i, 'fair'],
  [/不及格|不通过|不合格|缺考|取消|作弊|违纪|^F$/i, 'fail'],
  [/及格|通过|合格|^P$|^D$/i, 'pass'],
];

/**
 * 将成绩字符串映射为梯度 key（excellent / good / fair / pass / fail / null）。
 * 既支持百分制数字（如 92 / 85.5），也支持五级制/两级制中文成绩（如 优秀 / 良好 / 通过）。
 */
export function classifyGrade(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isNaN(n) && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    for (const lv of GRADE_LEVELS) if (n >= lv.min) return lv.key;
    return 'fail';
  }
  for (const [re, key] of TEXT_GRADE_MAP) {
    if (re.test(raw)) return key;
  }
  return null;
}

// ---- 成绩表格解析 ----
/** 解析成绩表格 <table id="dataList">，返回 { headers, dataRows }。 */
export function parseGrades(html, parse) {
  const doc = parse(html);
  const table = doc.querySelector(`table#${DATA_LIST_TABLE_ID}`) || doc.querySelector('table');
  if (!table) {
    throw new Error('成绩页结构可能已变化：找不到 <table>。请检查页面或更新解析逻辑。');
  }
  const rowsRaw = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('td,th'))
      .map((c) => (c.textContent || '').trim());
    if (cells.length) rowsRaw.push(cells);
  }
  if (!rowsRaw.length) throw new Error('成绩表格为空或解析失败。');
  return { headers: rowsRaw[0], dataRows: rowsRaw.slice(1).filter((r) => r.some((c) => c)) };
}

/**
 * 按 WANTED_COLUMNS 筛选有意义的列（开课学期/课程名称/学分/成绩/绩点）。
 * 先精确匹配表头，再按关键字模糊匹配；没匹配到则保留全部列。
 */
export function selectColumns(headers, rows) {
  const used = new Set();
  const indices = [];

  const findColumn = (key, excludes) => {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      if (headers[i] === key) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      if (headers[i].includes(key) && !excludes.some((ex) => headers[i].includes(ex))) {
        return i;
      }
    }
    return -1;
  };

  for (const [key, excludes] of WANTED_COLUMNS) {
    const idx = findColumn(key, excludes);
    if (idx !== -1) { indices.push(idx); used.add(idx); }
  }
  if (!indices.length) for (let i = 0; i < headers.length; i++) indices.push(i);
  indices.sort((a, b) => a - b);
  return {
    headers: indices.map((i) => headers[i]),
    rows: rows.map((r) => indices.map((i) => (i < r.length ? r[i] : ''))),
  };
}

// ---- 学期下拉解析 ----
/** 从 cjcx_query 页面提取表单字段与 kksj 下拉选项。返回 { fields, semesterOptions }。 */
export function extractQueryForm(html, parse) {
  const doc = parse(html);
  const form = doc.querySelector('form') || doc;
  const fields = {};

  for (const inp of form.querySelectorAll('input')) {
    const name = inp.getAttribute('name');
    if (!name) continue;
    const itype = (inp.getAttribute('type') || 'text').toLowerCase();
    if (itype === 'checkbox' || itype === 'radio') {
      if (inp.hasAttribute('checked')) fields[name] = inp.getAttribute('value') || 'on';
      else if (!(name in fields)) fields[name] = '';
    } else {
      fields[name] = inp.getAttribute('value') || '';
    }
  }

  let semesterOptions = [];
  for (const sel of form.querySelectorAll('select')) {
    const name = sel.getAttribute('name') || '';
    const opts = Array.from(sel.querySelectorAll('option')).map((opt) => ({
      value: opt.getAttribute('value') || '',
      text: textOf(opt),
    }));
    let defaultVal = '';
    for (const opt of sel.querySelectorAll('option')) {
      if (opt.hasAttribute('selected')) { defaultVal = opt.getAttribute('value') || ''; break; }
    }
    if (!defaultVal && opts.length) defaultVal = opts[0].value;
    if (name) fields[name] = defaultVal;
    if (name === KKSJ_FIELD) semesterOptions = opts;
  }
  return { fields, semesterOptions };
}

/** 将用户输入解析为 option value：value 精确 → 文本精确 → 模糊包含。 */
export function resolveSemester(userInput, options) {
  if (!userInput) return null;
  for (const { value } of options) if (value === userInput) return value;
  for (const { value, text } of options) if (text === userInput) return value;
  for (const { value, text } of options) {
    if (text.includes(userInput) || value.includes(userInput)) return value;
  }
  return null;
}

// ---- CAS 登录表单解析 ----
/** 从 CAS 登录页提取隐藏字段与 salt，并判断是否要求验证码。返回 { fields, captchaRequired }。 */
export function extractLoginForm(html, parse) {
  const doc = parse(html);
  const fields = {
    lt: '', pwdEncryptSalt: '', execution: '',
    _eventId: 'submit', cllt: 'userNameLogin', dllt: 'generalLogin',
  };

  let pwdForm = doc.querySelector('#pwdFromId');
  if (!pwdForm) {
    for (const form of doc.querySelectorAll('form')) {
      if (form.querySelector('input[name="cllt"][value="userNameLogin"]')) { pwdForm = form; break; }
    }
  }
  const root = pwdForm || doc;

  for (const inp of root.querySelectorAll('input[type="hidden"]')) {
    const name = inp.getAttribute('name') || inp.getAttribute('id');
    if (name in fields) fields[name] = inp.getAttribute('value') || '';
  }
  for (const fid of ['lt', 'pwdEncryptSalt']) {
    const el = root.querySelector(`#${fid}`);
    if (el && el.getAttribute('value')) fields[fid] = el.getAttribute('value');
  }
  const execEl = root.querySelector('input[name="execution"]');
  if (execEl && execEl.getAttribute('value')) fields.execution = execEl.getAttribute('value');

  if (!fields.pwdEncryptSalt) {
    const m = html.match(/pwdEncryptSalt\s*=\s*["']([A-Za-z0-9+/=]{16})["']/);
    if (m) fields.pwdEncryptSalt = m[1];
  }

  let captchaRequired = false;
  const captchaDiv = root.querySelector('#captchaDiv');
  if (captchaDiv) {
    const classes = (captchaDiv.getAttribute('class') || '').split(/\s+/);
    captchaRequired = !classes.includes('hide');
  }
  return { fields, captchaRequired };
}

// ---- 课表解析 ----
/** 从 <select id="zc"> 解析默认选中的周次。 */
export function parseDefaultWeek(doc) {
  const sel = doc.querySelector('select#zc');
  if (!sel) return null;
  const opt = sel.querySelector('option[selected]');
  if (!opt) return null;
  const v = (opt.getAttribute('value') || '').trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/** 从 <select id="xnxq01id"> 解析默认选中的学期 value。 */
export function parseDefaultSemester(doc) {
  const sel = doc.querySelector('select#xnxq01id');
  if (!sel) return null;
  const opt = sel.querySelector('option[selected]');
  if (!opt) return null;
  return (opt.getAttribute('value') || '').trim() || null;
}

/**
 * 从 weeks 字段解析小节起止范围，如 "1-16周[3-4节]" / "1-16周(3-4节)" / "3-4节" / "03-05节" -> { start, end }。
 * 兼容方括号、圆括号、裸写与单节；无法解析时可回退到大节行对应范围，避免课程被静默丢弃。
 */
export function parseCourseSections(weeksStr, fallbackRowIdx = null) {
  const m = String(weeksStr || '').match(/[\[(（]?\s*(\d+(?:\s*[-~–,、]\s*\d+)*)\s*节\s*[\])）]?/);
  if (m) {
    const nums = m[1]
      .split(/[-~–,、]/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 12);
    if (nums.length) return { start: Math.min(...nums), end: Math.max(...nums) };
  }
  if (fallbackRowIdx != null && SECTION_RANGES[fallbackRowIdx]) {
    return { ...SECTION_RANGES[fallbackRowIdx] };
  }
  return null;
}

/** 解析单个课表格子的课程列表。 */
export function parseScheduleCell(td) {
  const courses = [];
  for (const div of td.querySelectorAll('div.kbcontent')) {
    if ((div.getAttribute('id') || '').endsWith('-4')) continue;
    let current = {};
    for (const font of div.querySelectorAll('font')) {
      const style = font.getAttribute('style') || '';
      if (style.includes('display') && style.includes('none')) continue;
      const title = font.getAttribute('title') || '';
      const text = (font.textContent || '').trim();
      if (!text || text === '\u00a0') continue;
      if (!title) {
        if (Object.keys(current).length) courses.push(current);
        current = { name: text };
      } else if (title === '教师') current.teacher = text;
      else if (title === '周次(节次)') current.weeks = text;
      else if (title === '教室') current.room = text;
    }
    if (Object.keys(current).length) courses.push(current);
  }
  return courses;
}

/**
 * 解析课表 HTML。<table id="timetable">：前 2 行是表头/说明，
 * 之后每行一个大节，每行 7 个 td（周一~周日），备注行为 colspan=7 整行。
 */
export function parseSchedule(html, parse) {
  const doc = parse(html);
  const table = doc.querySelector(`table#${SCHEDULE_TABLE_ID}`);
  if (!table) throw new Error(`课表页结构可能已变化：找不到 <table id='${SCHEDULE_TABLE_ID}'>。`);

  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const grid = [];
  const notes = [];
  const rows = table.querySelectorAll('tr');
  for (let i = 2; i < rows.length; i++) {
    const tds = rows[i].querySelectorAll('td');
    if (!tds.length) continue;
    if ((tds[0].getAttribute('colspan') || '') === '7' || tds.length === 1) {
      const t = textOf(tds[0]);
      if (t) notes.push(t);
      continue;
    }
    grid.push(Array.from(tds).map((td) => parseScheduleCell(td)));
  }
  return {
    sections: SCHEDULE_SECTIONS,
    days,
    grid,
    notes,
    defaultWeek: parseDefaultWeek(doc),
    defaultSemester: parseDefaultSemester(doc),
  };
}

// ---- 通行码（zhjc.hhu.edu.cn）CAS Ticket 与接口解析 ----
/**
 * 从 CAS 重定向后的 URL 中提取 ticket 与 state。
 * 例：https://zhjc.hhu.edu.cn/mobile/?state=CAS_MOBILE_ACCESS-LOGIN/%23/pages/wxCas/index&ticket=ST-xxx
 */
export function extractCasTicket(url) {
  if (!url) return null;
  let ticket = null;
  let rawState = null;
  try {
    const parsed = new URL(url);
    ticket = parsed.searchParams.get('ticket');
    rawState = parsed.searchParams.get('state');
  } catch { /* fallback to regex */ }

  if (!ticket) {
    const m = String(url).match(/[?&]ticket=([^&#]+)/);
    if (m) ticket = decodeURIComponent(m[1]);
  }
  if (!rawState) {
    const m = String(url).match(/[?&]state=([^&#]+)/);
    if (m) rawState = decodeURIComponent(m[1]);
  }
  if (!ticket) return null;
  const state = (rawState ? rawState.split('-')[0] : '') || 'CAS_MOBILE_ACCESS';
  return { ticket, state };
}

/** 解析 zhjc `/admin/accessPerson/mobile/freshAccessQrCode` 返回的数据。 */
export function parseZhjcQrResponse(payload) {
  const data = payload?.data ?? payload;
  if (!data || (!data.qrCodeImage && !data.qrCodeContent)) {
    throw new Error(payload?.msg || '未能获取通行码数据');
  }
  const cleanB64 = data.qrCodeImage ? String(data.qrCodeImage).replace(/[\r\n\s]/g, '') : '';
  const qrCodeImage = cleanB64
    ? (cleanB64.startsWith('data:image/') ? cleanB64 : `data:image/png;base64,${cleanB64}`)
    : '';
  const expireTime = Number(data.expireTime) || (Date.now() + 60_000);
  return {
    qrCodeContent: data.qrCodeContent || '',
    qrCodeImage,
    expireTime,
  };
}

/** 解析 zhjc `/admin/accessPerson/mobile/loginUserBaseInfo` 返回的用户信息。 */
export function parseZhjcUserInfo(payload) {
  const data = payload?.data ?? payload ?? {};
  return {
    name: data.name || '',
    dept: data.shortDeptName || data.deptName || '',
    code: data.code || '',
    phone: data.phone || '',
    photoFileId: data.photoFileId || '',
    id: data.id || '',
  };
}
