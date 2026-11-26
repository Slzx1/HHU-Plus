// ============ Web 模式后端（Express） ============
// 复用同一份抓取引擎（web/js/engine），在 Node 里完成 CAS 登录 + 成绩 + 课表 + 通行码，
// 并通过 /proxy/* 反向代理为「办事大厅 / 奥兰系统」提供浏览器端免重登体验。

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import express from 'express';

import { makeScraper } from './node-env.js';
import { ScraperError } from '../web/js/engine/scraper.js';
import { createSession, getSession, getSessionEntry, destroySession, sessionCount } from './session.js';
import { createProxyRouter, parseCookiesFromReq } from './proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web');

// 修复原 bug：必须先读取 .env，再求值 PORT 与 HOST
function loadEnv() {
  const p = join(__dirname, '..', '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
const jsonParser = express.json({ limit: '1mb' });

// 异步路由统一错误包装
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 兼容从 JSON body.session_id 或 HttpOnly Cookie hhup_sid 读取会话 ID。 */
function resolveSid(req) {
  return req.body?.session_id || parseCookiesFromReq(req).hhup_sid || null;
}

// ---- API：登录 ----
app.post('/api/grades/login', jsonParser, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入学号和密码' });

  const scraper = makeScraper();
  await scraper.casLogin(username, password);
  await scraper.navigate();
  const { semesters, defaultSemester } = await scraper.getSemesters();

  const sessionId = createSession(scraper, { username });
  res.setHeader('Set-Cookie', `hhup_sid=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`);
  return res.json({ session_id: sessionId, semesters, default_semester: defaultSemester });
}));

// ---- API：会话校验（刷新页面时验证会话是否仍存活，不请求学校） ----
app.post('/api/session/check', jsonParser, (req, res) => {
  const sid = resolveSid(req);
  const entry = getSessionEntry(sid);
  if (!entry) return res.status(401).json({ valid: false, error: '会话不存在或已过期，请重新登录' });
  res.setHeader('Set-Cookie', `hhup_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
  return res.json({ valid: true, username: entry.username });
});

// ---- API：查成绩 ----
app.post('/api/grades/query', jsonParser, asyncHandler(async (req, res) => {
  const scraper = getSession(resolveSid(req));
  if (!scraper) return res.status(401).json({ error: '会话不存在或已过期，请重新登录' });

  const html = await scraper.queryGrades(req.body?.semester || null);
  const gpa_info = scraper.parseGpaInfo(html);
  const { headers, dataRows } = scraper.parseGrades(html);
  const grades = scraper.selectColumns(headers, dataRows);
  return res.json({ gpa_info, grades });
}));

// ---- API：查课表 ----
app.post('/api/schedule/query', jsonParser, asyncHandler(async (req, res) => {
  const scraper = getSession(resolveSid(req));
  if (!scraper) return res.status(401).json({ error: '会话不存在或已过期，请重新登录' });

  const html = await scraper.querySchedule(req.body?.semester || null, req.body?.week || null);
  const schedule = scraper.parseSchedule(html);
  return res.json({ schedule });
}));

// ---- API：获取 / 刷新校园通行码（复用同一 CAS 会话，免重登、免微信） ----
app.post('/api/passcode/query', jsonParser, asyncHandler(async (req, res) => {
  const scraper = getSession(resolveSid(req));
  if (!scraper) return res.status(401).json({ error: '会话不存在或已过期，请重新登录' });

  const { qr, user } = await scraper.queryPassCode({ refreshUser: Boolean(req.body?.refresh_user) });
  return res.json({ qr, user });
}));

// ---- API：登出 ----
app.post('/api/grades/logout', jsonParser, (req, res) => {
  destroySession(resolveSid(req));
  res.setHeader('Set-Cookie', 'hhup_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  return res.json({ success: true });
});

// ---- API：健康检查 ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessionCount() });
});

// ---- 免重登 SSO 代理（办事大厅 / 奥兰系统 / 官方门禁页） ----
// 注意：挂载在 jsonParser 之外，以完整透传表单/二进制请求体
app.use('/proxy', createProxyRouter());

// ---- 静态资源（前端 SPA） ----
app.use(express.static(WEB_DIR, { maxAge: 0 }));
app.get('/', (req, res) => res.sendFile(join(WEB_DIR, 'index.html')));

// ---- 统一错误处理 ----
app.use((err, req, res, next) => {
  if (err instanceof ScraperError) {
    const status = (err.code === 'SESSION_EXPIRED' || /会话/.test(err.message)) ? 401 : 400;
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
  console.log('  API: /api/grades/login|query|logout | /api/schedule/query | /api/passcode/query | /api/session/check | /proxy/*');
});
