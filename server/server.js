// ============ Web 模式后端（Express） ============
// 复用同一份抓取引擎（web/js/engine），在 Node 里完成 CAS 登录 + 查询，
// 再把结构化 JSON 返回给前端（浏览器前端因 CORS 无法直接请求 WebVPN）。
// 会话由 server/session.js 内存管理（cookie jar 挂在刮取器上，跨请求共享）。

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import express from 'express';

import { makeScraper } from './node-env.js';
import { ScraperError } from '../web/js/engine/scraper.js';
import { createSession, getSession, destroySession, sessionCount } from './session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web');
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '127.0.0.1';

// ---- 轻量 .env 读取（PORT/HOST），不存在则用默认 ----
function loadEnv() {
  const p = join(__dirname, '..', '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const app = express();
app.use(express.json({ limit: '1mb' }));

// 让异步路由的异常进入统一错误处理
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- API：登录 ----
app.post('/api/grades/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入学号和密码' });

  const scraper = makeScraper();           // 新建会话（含 cookie jar）
  await scraper.casLogin(username, password);
  await scraper.navigate();
  const { semesters, defaultSemester } = await scraper.getSemesters();

  const sessionId = createSession(scraper); // 绑定刮取器，供后续复用
  return res.json({ session_id: sessionId, semesters, default_semester: defaultSemester });
}));

// ---- API：查成绩 ----
app.post('/api/grades/query', asyncHandler(async (req, res) => {
  const { session_id, semester } = req.body || {};
  const scraper = getSession(session_id);
  if (!scraper) return res.status(401).json({ error: '会话不存在或已过期，请重新登录' });

  const html = await scraper.queryGrades(semester || null);
  const gpa_info = scraper.parseGpaInfo(html);
  const { headers, dataRows } = scraper.parseGrades(html);
  const grades = scraper.selectColumns(headers, dataRows);
  return res.json({ gpa_info, grades });
}));

// ---- API：查课表 ----
app.post('/api/schedule/query', asyncHandler(async (req, res) => {
  const { session_id, semester, week } = req.body || {};
  const scraper = getSession(session_id);
  if (!scraper) return res.status(401).json({ error: '会话不存在或已过期，请重新登录' });

  const html = await scraper.querySchedule(semester || null, week || null);
  const schedule = scraper.parseSchedule(html);
  return res.json({ schedule });
}));

// ---- API：登出 ----
app.post('/api/grades/logout', (req, res) => {
  destroySession((req.body || {}).session_id);
  return res.json({ success: true });
});

// ---- API：健康检查 ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessionCount() });
});

// ---- 静态资源（前端 SPA） ----
app.use(express.static(WEB_DIR, { maxAge: 0 }));
app.get('/', (req, res) => res.sendFile(join(WEB_DIR, 'index.html')));

// ---- 统一错误处理：业务异常 → 400/401；网络 → 502；未知 → 500 ----
app.use((err, req, res, next) => {
  if (err instanceof ScraperError) {
    const status = /会话/.test(err.message) ? 401 : 400;
    return res.status(status).json({ error: err.message });
  }
  const msg = String(err?.message || err);
  if (/fetch failed|超时|网络|ECONN|ETIMEDOUT|请求失败/i.test(msg)) {
    return res.status(502).json({ error: `网络错误: ${msg}` });
  }
  console.error('[server] 未处理异常:', err);
  return res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`HHU+ 后端启动: http://${HOST}:${PORT}`);
  console.log('  API: /api/grades/login|query|logout | /api/schedule/query | /api/health');
});
