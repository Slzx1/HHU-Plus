# HHU+ — 项目说明(AI 向)

河海大学信息门户手机版：**课表 / 成绩 / 办事大厅 / 奥兰系统** 四个功能。
**纯 JS**，单一抓取引擎一套代码跑三处：APK(离线) / Web(Node 后端) / CLI。原 Python(`grade_scraper.py`+Flask`app.py`)已全部移除。

## 架构（一份引擎，三端复用）

```
APK(WebView)   功能模块 → JS 引擎(浏览器环境, 离线)
浏览器(Web)    功能模块 → Node后端(server, Express) → 同一份JS引擎(Node环境)
终端(CLI)      cli.js → 同一份JS引擎
```

关键约束：**Capacitor 只打包 `web/`**，所以引擎/配置/前端都在 `web/` 下；`server` 与 `cli` 从 `web/js/*` import，保证只有一份实现、一个常量源。

## 目录分层

- `web/js/config.js` — **唯一常量源**（WebVPN 域名/编码host/URL/课表Section/超时/节流/缓存TTL）。改学校域名接口只改这里。
- `web/js/engine/` — 抓取引擎：`scraper.js`(登录/导航/成绩/课表+重试退避+followJsRedirect+isLoginPage+dom注入)、`parser.js`(纯解析函数+AES，可单测)。
- `web/js/platform/` — 环境适配，统一 `Backend` 接口：`login/query/querySchedule/openClassroom/openOrlan/logout`。`apk.js`(原生fetch+cookie持久化+InAppBrowser)、`web.js`(fetch→/api)、`index.js`(按环境动态选)。
- `web/js/features/` — **一功能一模块，自注册**：`index.js` 是注册表；`grades/schedule/classroom/orlan.js`。加功能=加一个文件+登记一行，`app.js` 不动。
- `web/js/{store,ui,icons,app}.js` — 状态持久化 / 通用UI / 图标 / 应用装配器(薄)。
- `server/` — Node 后端：`server.js`(Express, 静态web+/api/*+统一错误处理)、`node-env.js`(注入 linkedom+带cookie jar的fetch)、`session.js`(内存会话)。
- `cli.js`、`tests/`、`scripts/build-apk.{sh,bat}`。

## 规范(如何扩展，照抄现有模式)

1. **加功能 tab**：`web/js/features/<name>.js`(自注册 `{id,label,icon,type:'panel'|'external',render,onActivate}`) + `features/index.js` 加一行。面板功能用统一 `backend` 接口。
2. **改学校接口/域名**：只改 `web/js/config.js`；新增内网系统在 `INTERNAL_HOST_MAP` 加 host→WebVPN编码。
3. **加运行环境**：`web/js/platform/<name>.js` 实现统一 Backend + `platform/index.js` 注册。
4. **重要变更**：同步更新 `README.md` 与 `CLAUDE.md`。

## 关键 gotchas(踩过的坑/必须保留)

- **引擎与平台分离**：引擎(`engine`)只做抓取，不含 UI/登录态；`platform` 负责环境差异(APK cookie持久化等)。改学校页面结构只动 `parser.js`。
- **`parseCourseSections`(前端 schedule.js)兼容方括号/圆括号/裸写节次**：学校课表 week 字符串格式可能是 `[3-4节]` 或 `(3-4节)`，别改成只认一种。
- **APK cookie 持久化依赖自研原生桥**：`android/app/src/main/java/com/hhu/gradequery/MainActivity.java`(暴露 `HHUCookieHelper.getCookiesForUrl`) + CapacitorCookies 的 `setCookie`。这是非标准生成物，**必须保留**，别被 `npx cap add android` 覆盖。
- **appId 必须与 Gradle `applicationId=com.hhu.gradequery` 一致**(`capacitor.config.json`)，否则已装 APK 变"新应用"无法覆盖升级。
- **Node 后端会话是内存态**(`server/session.js`, TTL 1小时)，重启即丢；Web 模式重启需重新登录。
- **测试样本**：`tests/fixtures/*.html` 是从 `.trae/documents`(旧设计文档)推导的结构样本，页面结构变化先改 fixture 再改 `parser.js`。
- **`parseGpaInfo` 必须用「剥标签取文本」而非 DOM textContent**：某些解析器（linkedom）对嵌套标签（`<div><font>…</font></div>`）的 `doc.body.textContent` 返回空串，导致 Web 端 GPA 卡全空。已在 `parser.js` 用 `stripHtmlText()`（剥标签+解实体）实现，改时别退回 textContent。
- **查询复用会话、不重登**：引擎的 `fetchImpl` 闭包持有 cookie（Node 为 jar / APK 为原生 cookie），`queryGrades/querySchedule` 直接复用；只有响应被踢回登录页才算过期 → 走 `app.js` 的 `onSessionExpired`（**自动重登，带 30 分钟节流**）。别改成每次查询都重登（会导致风控封号）。
- **网页版跳奥兰/办事大厅会重登（架构固有）**：网页登录走后端代理，浏览器自身无 WebVPN cookie，新标签打开无法带会话；APK 端通过原生 cookie 共享（InAppBrowser `isIsolated:false` + `MainActivity` 桥）免登录。别在网页版误当 bug 去重写架构。
- **成绩明细是卡片式列表**（`features/grades.js` 的 `renderGradeList`），不是表格：左课程名+学期、右成绩(梯度着色)+学分/绩点。删 GPA 卡片别把"统计时间"加回来（用户嫌丑，`renderGpaCards` cfg 已不含）。
- **内容底部 padding 120px** 是为让位固定底部导航（`.content`），保证课表/成绩最后一科不被遮挡；改小会让最后一行被导航盖住。
- **办事大厅/奥兰用移动 UA（`MOBILE_UA`）**：`openClassroom`/`openOrlan` 都传；奥兰还要**延迟 `saveCookies`（800/2500ms）** 抓 smst 设备标记 cookie，否则"二次打开变电脑版"。改 `openWebView` 时别丢这两处。
- **会话「是否登录过」以 `semesters` 有无为准（`store.js` loadSession）**：APK 不存 session_id，若以 session_id 判定则重开永远回登录页（致命）。真实会话靠持久化 cookie；改 loadSession 别退回检查 session_id。
- **课表是双向冻结窗格**：`.schedule-card` 自身 `overflow:auto`+`max-height:60vh` 滚动；`.sg-header` 表头行 `sticky top`、`.sg-section` 节次列 `sticky left`、`.sg-corner` 左上角 `sticky both`。改课表 CSS/渲染时别破坏这三处 sticky。
- **内容底部 padding 在 media 查询里也保留 120px**：`.content` 的 `padding-bottom:120px` 要在 `@media(max-width:480px)` 里重现（`padding:12px` 会覆盖它），否则手机端最后一行被底部导航遮挡。
- **顶部应用栏要紧凑、别双重 inset**：去掉 body 的 `padding-top:env(...)`，只让 `.navbar` 用 `padding-top:max(12px,env(safe-area-inset-top))`，否则应用栏被 `viewport-fit=cover` 撑高出现大片空蓝。
- **查询课表首次加载用 GET 默认页(更准)**，手动查询用 POST + 下拉值，见 `features/schedule.js`。
- 全库没有 Python。若看到 `.env` 相关：`server/server.js` 只在 Node 端读 `.env`(PORT/HOST)；`config.js` 是纯常量，浏览器也能跑。
