# HHU+ — 项目说明(AI 向)

河海大学信息门户手机版：**课表 / 成绩 / 校园通行码 / 办事大厅 / 奥兰系统** 五大功能。
**纯 JS**，单一抓取引擎一套代码跑三处：APK(离线) / Web(Node 后端) / CLI。一次统一身份认证登录，全功能免重登复用，直到学校认证过期。

## 架构（一份引擎，三端复用）

```
APK(WebView)   功能模块 → JS 引擎(浏览器环境, 离线) + MainActivity Cookie 桥 + InAppBrowser
浏览器(Web)    功能模块 → Node 后端(server, Express + CookieJar + SSO 代理) → 同一份 JS 引擎(Node 环境)
终端(CLI)      cli.js → 同一份 JS 引擎
```

关键约束：**Capacitor 只打包 `web/`**，所以引擎/配置/前端都在 `web/` 下；`server` 与 `cli` 从 `web/js/*` import，保证只有一份实现、一个常量源。

## 目录分层

- `web/js/config.js` — **唯一常量源**（WebVPN 域名/编码 host/URL/课表 Section/ZHJC 通行码 SSO 接口/APK Cookie 路径表/超时/节流/TTL）。改学校域名接口只改这里。
- `web/js/engine/` — 抓取引擎：`scraper.js`（CAS 登录/导航/成绩/课表/ZHJC 通行码单点换票与 424 自动刷新+重试退避+isLoginPage）、`parser.js`（纯解析函数+AES+中英文成绩分级+节次解析+CAS ticket 提取，可单测）。
- `web/js/platform/` — 环境适配，统一 `Backend` 接口：`restoreSession/login/query/querySchedule/queryPassCode/openClassroom/openOrlan/openPassCodeWeb/getProxyUrl/logout`。`apk.js`（原生 fetch + 多域多路径 cookie 持久化落盘 + InAppBrowser）、`web.js`（fetch → `/api` + 免登代理 `/proxy/open/*`）、`index.js`。
- `web/js/features/` — **一功能一模块，自注册**：`index.js` 是注册表；`schedule/grades/passcode/classroom/orlan.js`。加功能=加一个文件+登记一行，`app.js` 不动。
- `web/js/{store,ui,icons,app}.js` — 状态与缓存持久化 / 通用 UI 与弹窗抽屉 / 统一线性 SVG 图标 / 应用装配器（双端导航+亮暗主题+单飞静默续期）。
- `server/` — Node 后端：`server.js`（Express, 静态 web + `/api/*` + `/proxy/*` + 统一错误处理）、`cookie-jar.js`（域/路径感知 RFC CookieJar）、`node-env.js`（linkedom + 手动重定向跟踪 fetch，避免吞 302 Set-Cookie）、`proxy.js`（仅限 `*.hhu.edu.cn` 的免重登 SSO 反向代理）、`session.js`（滑动 TTL 内存会话 + 定期清理）。
- `cli.js`、`tests/`、`scripts/build-apk.{sh,bat}`、`scripts/gen-doc-shots.mjs`。

## 规范(如何扩展，照抄现有模式)

1. **加功能 tab**：`web/js/features/<name>.js`（自注册 `{id,label,title,icon,type:'panel'|'portal',render,onActivate,onDeactivate,reset}`）+ `features/index.js` 加一行。
2. **改学校接口/域名**：只改 `web/js/config.js`；新增内网系统在 `INTERNAL_HOST_MAP` 加 host→WebVPN 编码。
3. **加运行环境**：`web/js/platform/<name>.js` 实现统一 Backend + `platform/index.js` 注册。
4. **重要变更**：同步更新 `README.md`、`USER_GUIDE.md` 与 `CLAUDE.md`。

## 关键 gotchas(踩过的坑/必须保留)

- **引擎与平台分离**：引擎(`engine`)只做抓取，不含 UI/登录态；`platform` 负责环境差异(APK cookie 持久化 / Web 代理)。改学校页面结构只动 `parser.js`。
- **`parseCourseSections`(在 `engine/parser.js`)兼容方括号/圆括号/裸写/单节及大节回退**：学校课表 week 格式可能是 `[3-4节]` 或 `(3-4节)`，无法解析时回退到大节行范围，绝不静默丢课。
- **APK cookie 持久化依赖自研原生桥**：`android/app/src/main/java/com/hhu/gradequery/MainActivity.java`（暴露 `HHUCookieHelper.getCookiesForUrl` / `setCookie` / `flushCookies`）+ `APK_COOKIE_URLS` 多路径（含 `/https/${HOST_CAS}/authserver/` 的 `CASTGC`）持久化与落盘。这是非标准生成物，**必须保留**，别被 `npx cap add android` 覆盖。
- **appId 必须与 Gradle `applicationId=com.hhu.gradequery` 一致**(`capacitor.config.json`)，否则已装 APK 变"新应用"无法覆盖升级。
- **Node 端 fetch 必须用 `redirect: 'manual'` 逐跳跟踪 + `CookieJar`**（`server/node-env.js` + `server/cookie-jar.js`）：原生 `redirect:'follow'` 会吞掉中间 302 的 `Set-Cookie`，导致 CAS 票据与多域 cookie 丢失。
- **Web 端刷新页面恢复会话**：`web.js` 启动时通过 `restoreSession()` 从 `store` 读回 `sessionId` 并调用 `/api/session/check`，防止刷新误踢回登录页。
- **Web 端免重登访问办事大厅 / 奥兰 / 门禁原页**：通过 `server/proxy.js`（`/proxy/open/{classroom|orlan|zhjc}`）复用同一份服务端 `CookieJar` 与 `MOBILE_UA`；严格限制仅允许 `*.hhu.edu.cn` 防 SSRF。
- **校园通行码（`zhjc.hhu.edu.cn`）单点登录**：复用已有 WebVPN CAS 会话请求 `ZHJC_CAS_URL` 拿 `ticket`，再 POST `/admin/oauth2/token` 换取 Bearer `access_token` 调用 `/admin/accessPerson/mobile/freshAccessQrCode` 与 `/loginUserBaseInfo`。遇到 HTTP 401/403/424 时自动走 CAS 静默换新 token，无需微信与重复登录。
- **`parseGpaInfo` 必须用「剥标签取文本」而非 DOM textContent**：linkedom 对嵌套 `<font>` 返回空串，已在 `parser.js` 用 `stripHtmlText()` 实现。
- **查询复用会话、不重登；过期走单飞静默续期**：`app.js` 的 `onSessionExpired` 使用 `reloginPromise` 单飞锁 + 30 分钟节流，避免并发请求触发多次重登导致风控。
- **面板 `reset()` 不可销毁已挂载 DOM 标记**：重登后会复用同一面板 DOM，只清空 `loaded` 与渲染数据。
- **成绩明细是卡片式列表**（非表格），GPA 卡片不含"统计时间"，同时支持百分制数字与中文等级（优秀/良好/中等/及格/通过/不及格）。
- **内容底部 padding 120px**（含 `@media (max-width:480px)` 内）为固定底部导航让位；**顶部应用栏紧凑、单层 inset**（只让 `.navbar` 用 `padding-top:max(12px,env(safe-area-inset-top))`）。
- **全局 `[hidden] { display: none !important; }`**（`tokens.css`），防止 flex/grid 样式覆盖 HTML `hidden` 属性。
- **课表双向冻结窗格**：`.schedule-card` 单一滚动容器 + `.sg-header` sticky top + `.sg-section` sticky left + `.sg-corner` sticky both。首次加载 GET 默认页，手动查询 POST。
- **办事大厅 / 奥兰用 `MOBILE_UA` + 延迟 `saveCookies`（800/2500ms）**：防止二次打开变电脑版。
- **会话「是否登录过」以 `semesters.length` 为准**（`store.js` `loadSession`）。
