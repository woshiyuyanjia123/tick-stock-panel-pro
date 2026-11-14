@echo off
chcp 65001 >nul
title TICK STOCK PANEL Pro v1.1.0-enterprise - 独立桌面客户端启动器
cd /d "%~dp0"

if not exist "node_modules" (
  echo [1/3] 首次启动，正在安装依赖...
  call npm install
)

if not exist "dist\index.html" (
  echo [2/3] 未检测到前端构建产物，正在执行构建...
  call npm run build
)

if not exist "TSP_Pro_Desktop.exe" (
  echo [3/3] 未检测到桌面客户端可执行文件，正在编译 TSP_Pro_Desktop.exe ...
  call npm run desktop:build
)

start "" "%~dp0TSP_Pro_Desktop.exe"
exit /b 0
