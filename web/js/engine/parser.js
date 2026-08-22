// ============ 核心解析层（纯函数，可单测） ============
// 这些函数不含网络请求、不依赖全局环境，只做「HTML/文本 -> 结构化数据」。
// 为了让同一份代码在浏览器（DOMParser）与 Node（linkedom）都能跑，
// 每个需要 DOM 的函数都接收一个已注入的 `parse` 工厂（见 engine/scraper.js 的装配）。
//
// ✅ 之所以单独拆成一个文件：解析逻辑最容易因学校页面结构变化而失效，
//    独立成纯函数后可用 tests/fixtures/*.html 做回归单测。

import {
  ENCRYPT_CHARS, WANTED_COLUMNS, SCHEDULE_SECTIONS,
  SCHEDULE_TABLE_ID, DATA_LIST_TABLE_ID, KKSJ_FIELD,
} from '../config.js';

// ---- GPA 文本块各指标的正则 ----
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
/** 生成随机串。测试时可注入返回固定序列的 rng 以获得已知答案。 */
function defaultRng(length) {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += ENCRYPT_CHARS[Math.floor(Math.random() * ENCRYPT_CHARS.length)];
  }
  return s;
}

/** Uint8Array -> base64（对应 Python base64.b64encode）。分块避免栈溢出。 */
function uint8ToBase64(bytes) {
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
 * 返回 ciphertext 的 base64。
 * @param {string} password 明文密码
 * @param {string} salt 学校页面下发的 pwdEncryptSalt（16 字符）
 * @param {(n:number)=>string} [rng] 随机源，测试注入固定序列
 */
export async function encryptPassword(password, salt, rng = defaultRng) {
  if (!salt) return password;
  const plaintext = rng(64) + password;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(salt),
    { name: 'AES-CBC' }, false, ['encrypt'],
  );
  // Web Crypto AES-CBC 默认 PKCS7 padding，与 pycryptodome 一致
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(rng(16)) },
    key, new TextEncoder().encode(plaintext),
  );
  return uint8ToBase64(new Uint8Array(cipher));
}

// ---- 通用 DOM 工具 ----
function textOf(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }

/**
 * 从原始 HTML 提取纯文本（剥掉所有标签 + 解码常见 HTML 实体 + 压空白）。
 * 不依赖 DOM 解析器 —— 某些解析器（如 linkedom）对嵌套标签的文本提取不可靠
 * （实测 doc.body.textContent 对 `<div><font>…</font></div>` 返回空），
 * 而 GPA 文本块正是这种嵌套结构，所以这里直接用原始 HTML 剥标签，浏览器/Node 行为一致。
 */
function stripHtmlText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')        // 先剔除脚本/样式内容
    .replace(/<[^>]+>/g, ' ')                                // 剥掉所有标签
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
    // 精确
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      if (headers[i] === key) return i;
    }
    // 模糊
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

  // 只定位「用户名密码登录」表单（id=pwdFromId，或含 cllt=userNameLogin），
  // 避免被手机动态码/二维码表单里的 captchaDiv 干扰
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
  // 兜底：从内联 JS 提取 salt
  if (!fields.pwdEncryptSalt) {
    const m = html.match(/pwdEncryptSalt\s*=\s*"([A-Za-z0-9+/=]{16})"/);
    if (m) fields.pwdEncryptSalt = m[1];
  }

  // 仅在用户名密码表单内判断 captchaDiv 是否含 'hide' class
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

/** 解析单个课表格子的课程列表。 */
export function parseScheduleCell(td) {
  const courses = [];
  // 只取 div.kbcontent（含教师信息更完整），跳过信息不全的 kbcontent1 与空占位
  for (const div of td.querySelectorAll('div.kbcontent')) {
    if ((div.getAttribute('id') || '').endsWith('-4')) continue;
    let current = {};
    for (const font of div.querySelectorAll('font')) {
      const style = font.getAttribute('style') || '';
      if (style.includes('display') && style.includes('none')) continue;  // 跳过隐藏辅助信息
      const title = font.getAttribute('title') || '';
      const text = (font.textContent || '').trim();
      if (!text || text === ' ') continue;
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
 * 解析课表 HTML。表格 <table id="timetable">：前 2 行是 banner/表头，
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
