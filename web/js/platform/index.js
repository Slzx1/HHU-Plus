// ============ 平台选择 ============
// 根据运行环境动态加载对应 Backend 实现，统一暴露「平台无关」的 backend 接口。
//   - APK（Capacitor）：apk.js —— 离线，用 native fetch + cookie 持久化
//   - 浏览器：web.js —— 请求本地 Node 后端 /api
// 识别方式：window.Capacitor.isNativePlatform()（APK 中由 Capacitor 注入）。

export async function pickBackend() {
  if (window.Capacitor?.isNativePlatform?.()) {
    return (await import('./apk.js')).backend;
  }
  return (await import('./web.js')).backend;
}
