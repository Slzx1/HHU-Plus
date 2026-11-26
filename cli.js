#!/usr/bin/env node
// ============ CLI 模式：一条命令完成登录 + 成绩 / 课表 / 通行码抓取 ============
// 复用同一份抓取引擎（web/js/engine），在 Node 里离线执行。
// 用法：
//   node cli.js                          # 查成绩（默认凭据文件 账密.txt）
//   node cli.js --credential-file xx.txt # 指定凭据文件（全角冒号）
//   node cli.js --cookie-file cookies.json # Cookie 回退（应对验证码）
//   node cli.js --semester "2025-2026-1" # 指定学期
//   node cli.js --passcode               # 获取校园通行码信息与有效期

import { readFileSync, existsSync } from 'node:fs';
import { makeScraper, CookieJar } from './server/node-env.js';

const DEFAULT_CRED = process.env.CREDENTIAL_FILE || '账密.txt';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }

/** 读取凭据文件。格式：`账户：<学号>` / `密码：<密码>`。 */
function loadCredentials(path) {
  if (!existsSync(path)) throw new Error(`凭据文件不存在: ${path}`);
  let username = '', password = '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(账户|账号|用户名|username)\s*[:：]\s*(.+)\s*$/i);
    if (m) { username = m[2].trim(); continue; }
    const m2 = line.match(/^\s*(密码|password)\s*[:：]\s*(.+)\s*$/i);
    if (m2) { password = m2[2].trim(); continue; }
  }
  if (!username || !password) throw new Error(`凭据文件格式错误（需要 "账户：" 与 "密码：" 两行）: ${path}`);
  return { username, password };
}

/** 读取 Cookie 回退文件（{cookies:[{name,value,domain,path}]} 或直接数组），注入 CookieJar。 */
function loadCookies(path, jar) {
  if (!existsSync(path)) throw new Error(`Cookie 文件不存在: ${path}`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(data) ? data : (data.cookies || []);
  for (const c of list) {
    if (c.name) jar.setSimple(c.name, c.value || '', c.domain || 'webvpn.hhu.edu.cn', c.path || '/');
  }
  console.log(`  已加载 ${list.length} 条 Cookie。`);
}

// ---- 终端表格（中文按全角宽度对齐） ----
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    w += (cp >= 0x1100 && (cp <= 0x115F || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF))) ? 2 : 1;
  }
  return w;
}
function padToWidth(s, width) {
  const pad = width - displayWidth(s);
  return String(s) + (pad > 0 ? ' '.repeat(pad) : '');
}
function printTable(headers, rows) {
  const widths = headers.map(displayWidth);
  for (const r of rows) r.forEach((c, i) => { if (i < widths.length) widths[i] = Math.max(widths[i], displayWidth(c)); });
  const sep = '  ';
  console.log(headers.map((h, i) => padToWidth(h, widths[i])).join(sep));
  console.log(widths.map((w) => '-'.repeat(w)).join(sep));
  rows.forEach((r) => console.log(r.map((c, i) => padToWidth(c, widths[i])).join(sep)));
}

const MAIN_KEYS = ['学位绩点', '平均学分绩点', '平均成绩', '所修门数', '所修总学分'];
const EXTRA_KEYS = ['推优绩点', '推优平均成绩', '出国就业平均成绩', '专业排名', '统计时间'];
function printGpa(info) {
  if (!Object.keys(info).length) { console.log('\n(未提取到 GPA 统计信息)'); return; }
  console.log();
  for (const keys of [MAIN_KEYS, EXTRA_KEYS]) {
    const parts = keys.filter((k) => info[k]).map((k) => `${k}: ${info[k]}`);
    if (parts.length) console.log('  ' + parts.join('  |  '));
  }
}

async function main() {
  const credentialFile = arg('credential-file', DEFAULT_CRED);
  const cookieFile = arg('cookie-file', null);
  const semester = arg('semester', null);
  const showPassCode = hasFlag('passcode');

  const jar = new CookieJar();
  const scraper = makeScraper(jar);

  if (cookieFile) {
    console.log('使用 Cookie 回退模式，跳过登录...');
    loadCookies(cookieFile, jar);
  } else {
    const { username, password } = loadCredentials(credentialFile);
    await scraper.casLogin(username, password);
    await scraper.navigate();
  }

  if (showPassCode) {
    const { qr, user } = await scraper.queryPassCode();
    console.log('\n=== 河海大学校园通行码 ===');
    if (user.name) console.log(`  姓名: ${user.name}  |  部门: ${user.dept}  |  学号: ${user.code}`);
    console.log(`  有效期至: ${new Date(qr.expireTime).toLocaleString('zh-CN')}`);
    console.log(`  二维码内容: ${qr.qrCodeContent || '(图片模式)'}`);
    return;
  }

  const html = await scraper.queryGrades(semester);
  const gpaInfo = scraper.parseGpaInfo(html);
  const { headers, dataRows } = scraper.parseGrades(html);
  const { headers: subH, rows: subR } = scraper.selectColumns(headers, dataRows);

  console.log();
  printTable(subH, subR);
  printGpa(gpaInfo);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
