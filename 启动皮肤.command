#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo " [错误] 未检测到 Node.js"
  echo " 请先安装 Node.js 22 或更高版本：https://nodejs.org/"
  echo " 安装完成后重新双击本文件即可。"
  echo ""
  read -r -p "按回车退出..."
  exit 1
fi
echo " 正在启动 ChatGPT 照片皮肤..."
node injector/inject.mjs --yes "$@"
echo ""
read -r -p "按回车退出..."
