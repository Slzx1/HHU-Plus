@echo off
REM ========================================================================
REM   HHU+ APK Build Script (Windows)
REM   SDK/Gradle 都放在项目目录下, 避免污染 C:
REM   前置: JDK 17+ / Android SDK (.android-sdk) / npx cap add android 已生成
REM   用法: scripts\build-apk.bat [--no-sync]
REM ========================================================================
setlocal

REM 项目根目录(本脚本上一级)
set "ROOT=%~dp0.."

REM JDK / Android SDK / Gradle home(按需改路径)
if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
if not defined ANDROID_HOME set "ANDROID_HOME=%ROOT%\.android-sdk"
if not defined GRADLE_USER_HOME set "GRADLE_USER_HOME=%ROOT%\.gradle-home"

if "%1"=="--no-sync" goto build

echo [1/2] Syncing web assets...
cd /d "%ROOT%"
call npx cap sync android

:build
echo [2/2] Building APK...
cd /d "%ROOT%\android"
call .\gradlew.bat assembleDebug --no-daemon --console=plain %*

echo.
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo BUILD SUCCESS
    echo APK: %ROOT%\android\app\build\outputs\apk\debug\app-debug.apk
) else (
    echo BUILD FAILED
)
endlocal
