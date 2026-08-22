#!/usr/bin/env bash
# ========================================================================
#   在 macOS 上安装 Android SDK Command-line Tools（一次性）
#   下载 commandline-tools -> 装 platform-tools / platforms;android-36 /
#     build-tools;36.1.0（版本按 android/app/build.gradle 的 compileSdk 定）
#   完成后写 android/local.properties 的 sdk.dir，供 gradlew 使用。
#   依赖: curl / unzip（macOS 自带）；需联网。
#   用法: ./scripts/setup-android-sdk.sh
# ========================================================================
set -euo pipefail

# 项目的 cmdline-tools 版本（Google 仓库，已验证可达）
CMDLINE_VERSION="11076708"
URL="https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINE_VERSION}_latest.zip"
SDK="${ANDROID_HOME:-$HOME/Android/sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "SDK 安装目录: $SDK"
mkdir -p "$SDK/cmdline-tools"

echo "[1/3] 下载 commandline-tools (约 153MB)..."
curl -L --fail "$URL" -o /tmp/cmdline-tools.zip

echo "[2/3] 解压到 cmdline-tools/latest..."
rm -rf /tmp/cmdline-tools-extract "$SDK/cmdline-tools/latest"
unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-extract
mkdir -p "$SDK/cmdline-tools/latest"
cp -R /tmp/cmdline-tools-extract/cmdline-tools/. "$SDK/cmdline-tools/latest/"
chmod +x "$SDK/cmdline-tools/latest/bin/sdkmanager"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"

echo "[3/3] 接受许可并安装 platform-tools / platforms;android-36 / build-tools;36.1.0..."
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --sdk_root="$SDK" "platform-tools" "platforms;android-36" "build-tools;36.1.0"

# 写 local.properties 供 gradlew 定位 SDK
echo "sdk.dir=$SDK" > "$ROOT/android/local.properties"

echo ""
echo "✅ Android SDK 就绪: $SDK"
echo "   已写 $ROOT/android/local.properties (sdk.dir=$SDK)"
echo "   接下来可运行 ./scripts/build-apk.sh 构建 APK。"
