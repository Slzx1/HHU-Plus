#!/usr/bin/env bash
# ========================================================================
#   HHU+ APK 构建脚本（macOS）
#   前置（一次性）：
#     - 安装 JDK 17+（推荐 Temurin 21），并 export JAVA_HOME
#     - 安装 Android SDK Command-line Tools，并 export ANDROID_HOME
#       （或用 Android Studio 安装；本脚本读取环境变量，未设置则提示）
#     - npm install 已执行过
#   用法：./scripts/build-apk.sh [--no-sync]
#   --no-sync 跳过 cap sync（web 未改动时可加速）
# ========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."        # 切到项目根

if [[ -z "${JAVA_HOME:-}" ]]; then echo "⚠️  JAVAHOME 未设置，请在 ~/.zshrc export 后重试"; fi
if [[ -z "${ANDROID_HOME:-}" ]]; then echo "⚠️  ANDROID_HOME 未设置，请在 ~/.zshrc export 后重试"; fi

if [[ "${1:-}" != "--no-sync" ]]; then
  echo "[1/2] 同步前端资源到 android 工程..."
  npx cap sync android
fi

echo "[2/2] 构建 APK..."
cd android
./gradlew assembleDebug --no-daemon --console=plain

APK="app/build/outputs/apk/debug/app-debug.apk"
if [[ -f "$APK" ]]; then
  echo ""
  echo "✅ 构建成功: $(pwd)/$APK"
else
  echo "❌ 构建失败（未找到 $APK）" >&2
  exit 1
fi
