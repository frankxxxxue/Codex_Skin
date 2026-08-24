@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [错误] 未检测到 Node.js
    echo  请先安装 Node.js 22 或更高版本：https://nodejs.org/
    echo  安装完成后重新双击本文件即可。
    echo.
    pause
    exit /b 1
)

echo  正在启动 ChatGPT 照片皮肤...
node injector\inject.mjs --yes %*
echo.
pause
