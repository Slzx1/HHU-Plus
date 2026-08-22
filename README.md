# HHU+ — 河海大学信息门户手机版

> 👤 **普通用户**请看 [USER_GUIDE.md（用户指南）](USER_GUIDE.md)（安装/使用/常见问题）。
> 🛠 **开发者**请继续往下读。
> 课表 · 成绩 · 办事大厅 · 奥兰系统，一屏搞定。
> 一份抓取引擎跑三端：**APK（离线）/ Web（浏览器）/ CLI**。

HHU+ 是面向河海大学在校生的课余开源项目，把校园里常用且分散的几个系统（教务成绩、课表、办事大厅、奥兰学生管理）收进一个手机友好的界面。它**不是官方应用**，数据全部来自学校现有的 WebVPN 教务系统，仅供学习与个人使用。

**欢迎河海的校友开发者一起加入。** 项目刻意做得小而清晰，方便单人长期维护、也方便新同学快速上手。

---

## 功能一览

| 功能 | 说明 |
|---|---|
| 📅 课表 | 周视图，选学期/周次；表头与「节次」列双向冻结，上下/左右滚动都看得清 |
| 📊 成绩 | GPA 统计卡片 + 卡片式成绩列表，按分数梯度着色（高分绿 → 低分紫） |
| 🏛 办事大厅 | 一键进入学校办事大厅（taskcenter） 可办理请假、教室申请等|
| 👤 奥兰系统 | 一键经 CAS 单点登录进入奥兰学生管理信息系统，可登记离校、选宿舍等 |

一次登录，四个功能都能用；**跳转奥兰/办事大厅免重新登录，清后台重开也不重登**。

![课表示例](docs/images/schedule.png)

> 以上为示例界面（模拟数据，非真实信息）。更多界面与安装/使用说明见 [USER_GUIDE.md](USER_GUIDE.md)。

---

## 为什么要做成"一份代码三端跑"

最早这个项目是 Python 写一遍抓取、再手动移植成 JS 打包 APK，两套逻辑经常漂移、很难维护。重构后收敛为**一套**：

```
请求流
  APK(WebView)  功能模块 → 抓取引擎(浏览器环境, 离线)
  浏览器(Web)   功能模块 → Node后端(server, Express) → 同一份抓取引擎(Node环境)
  终端(CLI)     cli.js → 同一份抓取引擎
```

- 唯一抓取引擎：`web/js/engine/`（CAS 登录 / AES 加密 / 成绩 / 课表 / 解析）。
- 平台差异只用薄适配层 `web/js/platform/{apk,web}.js`（决定引擎在哪跑、cookie 怎么持久化）。
- 功能以**可插拔模块**组织：`web/js/features/*.js`（一功能一文件，自注册）。
- 关键原则：**Capacitor 只打包 `web/`**，所以引擎/前端都在 `web/` 下；`server` 与 `cli` 从同一处 import，全项目只有一个常量源 `web/js/config.js`。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端/引擎 | 原生 JS（ES modules）+ CSS 变量，无框架 |
| Web 后端 | Node.js + Express |
| APK | Capacitor 8（Android WebView 壳 + 自研 cookie 原生桥） |
| 测试 | `node --test` + HTML fixture + AES 已知答案 |

## 目录结构

> 顶层按职能分四块：**`web/`（前端 + 引擎，也是 APK 打包的内容）**、**`server/` + `cli.js`（Web / CLI 后端）**、**`tests/`（测试）**、**其余（构建 / 文档 / 平台壳）**。

```
web/                       # Capacitor webDir：APK 离线运行的全部内容都在这里
├─ js/
│  ├─ config.js            # ★ 唯一常量源：学校域名/URL/课表时段/超时/节流。改接口只改这里。
│  ├─ engine/              # 抓取引擎（唯一实现，server / cli 也从此 import）
│  │  ├─ scraper.js        #   登录 / 导航 / 查询 / 重试 / 会话过期判断
│  │  └─ parser.js         #   纯解析函数（GPA/成绩/课表/列筛选）+ AES 加密，可单测
│  ├─ platform/            # 环境适配，统一 Backend 接口
│  │  ├─ apk.js            #   APK：原生 fetch + cookie 持久化 + InAppBrowser
│  │  ├─ web.js            #   浏览器：fetch → Node 后端 /api
│  │  └─ index.js          #   按运行环境挑选实现
│  ├─ features/            # ★ 一功能一模块，自注册（加功能 = 加一个文件 + index 登记一行）
│  │  ├─ index.js          #   功能注册表
│  │  └─ grades.js  schedule.js  classroom.js  orlan.js
│  ├─ store.js             # localStorage 状态（会话/缓存/节流/凭据）
│  ├─ ui.js                # toast / 错误 / 加载 / 下拉 等通用件
│  ├─ icons.js             # Material 风格 SVG 图标
│  └─ app.js               # 装配器：注册功能、选平台、登录/会话编排（薄）
└─ css/                    # tokens.css（设计变量）+ components.css（组件样式）

server/                    # Web 模式后端（Node + Express）
├─ server.js               # 静态 web + /api/* + 统一错误处理
├─ node-env.js             # 注入 DOM 解析器(linkedom) + 带 cookie jar 的 fetch
└─ session.js              # 会话存储（内存 + TTL）

cli.js                     # CLI：读凭据 / Cookie 回退 → 对齐表格 + GPA

tests/                     # node --test 单测
├─ fixtures/*.html         #   学校页面结构样本（CAS 登录 / 成绩 / 课表）
└─ *.test.js               #   解析 / AES / 表单提取 单测

scripts/                   # 构建与工具
├─ build-apk.sh  build-apk.bat   # Mac / Windows 构建 APK
├─ setup-android-sdk.sh          # 一次性：安装 Android SDK
└─ gen-doc-shots.mjs             # 重新生成 README 示例截图

docs/                      # 文档与示例截图（模拟数据，不含真实信息）
android/                   # Capacitor 生成壳（含自研 cookie 原生桥 MainActivity.java）
```

## 快速开始

### Web 模式（浏览器 + 本地后端）

```bash
npm install
npm run server            # http://127.0.0.1:5000
```

### CLI 模式

```bash
# 建一个「账密.txt」，两行（全角冒号）：
#   账户：<学号>
#   密码：<密码>
node cli.js --credential-file 账密.txt [--semester "2025-2026-1"]
# Cookie 回退（应对验证码）：
node cli.js --cookie-file cookies.json
```

### APK 模式（Capacitor）

```bash
npm install
./scripts/setup-android-sdk.sh    # 一次性：装 Android SDK（platform-36 / build-tools 36.1.0）
./scripts/build-apk.sh            # cap sync + gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

## 开发者如何加东西（本项目固定套路）

**加一个功能 tab**（如「考试安排」）：
1. 仿 `web/js/features/grades.js`（面板类）或 `classroom.js`（外链类），新建 `web/js/features/exam.js`；
2. 在 `web/js/features/index.js` 的 `features` 数组加一行；
3. 底部导航与面板自动生成，`app.js` 无需改动。

**改学校接口/域名**：只改 `web/js/config.js`；新增内网系统在 `INTERNAL_HOST_MAP` 加一条 host → WebVPN 编码串。

**加运行环境**：仿 `web/js/platform/web.js` 实现统一 `Backend` 接口，并在 `platform/index.js` 注册判定。

> 上面这些套路在 `/CLAUDE.md`（面向 AI 的项目说明）里也写了，照抄现有模式即可。

## 测试

```bash
npm test                  # node --test tests/*.test.js
```
`tests/fixtures/*.html` 是学校页面的结构样本，页面一变这些测试先报警，改动时同步更新 fixture。

## 设计要点与注意

- **会话复用、过期自动重登**：查询复用同一会话（绝不重登，防触发学校风控封号）；仅当被踢回登录页才自动重登，且带 30 分钟节流。APK 用自研 cookie 原生桥持久化会话，**清后台重开不重登**。
- **APK 免登录的 cookie 桥**在 `android/app/src/main/java/com/hhu/gradequery/MainActivity.java`（非标准生成物，`npx cap add android` 会覆盖，务必保留）。
- `appId` 必须与 Gradle `applicationId=com.hhu.gradequery` 一致，否则已装 APP 变"新应用"无法覆盖升级。
- 详情见 [USER_GUIDE.md（用户指南）](USER_GUIDE.md)。

## 隐私 & 安全

- 本项目**不含任何账号/密码/个人数据**。账号密码由使用者自己运行时输入（Web/CLI）或保存在本机（APK 的"自动登录"）。
- 所有数据取自学校 WebVPN 教务系统，需本人学号密码登录；学校接口未公开稳定，可能随学校调整而变化（见故障排查）。
- 开源展示用的是**示例截图**（`docs/images/`），不含真实成绩。

## 开发约定（贡献者请遵守）

本项目最看重**可维护性**，请延续以下风格：

1. **可插拔模块化**：新功能 = `web/js/features/` 一个自注册文件 + `index.js` 登记一行，`app.js` 不改。
2. **统一接口**：对外统一 `Backend`（`login/query/querySchedule/openClassroom/openOrlan/logout`）与引擎 `Scraper`；错误统一 `{error}`；常量统一写 `web/js/config.js`。
3. **面向人注释**：凡"人要改/要加"处写清"在哪改、怎么改"（参考 `config.js` 头部、`CLAUDE.md`）。
4. **简洁**：不堆冗余抽象层、不为"以后可能用"提前加设计。
5. **重要变更同步文档**：改了行为/结构，同步更新 `README.md` 与 `CLAUDE.md`。
6. **测试兜底**：改学校页面解析时，先改 `tests/fixtures/*.html` 再改 `parser.js`，并跑 `npm test`。

> AI/工具辅助开发可读 `CLAUDE.md`；内部实现细节与踩坑也记录在那里。

## License

> MIT
