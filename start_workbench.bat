@echo off
chcp 65001 >nul
title TICK STOCK PANEL Pro v1.1.0-enterprise - 天才交易员量化桌面终端
cd /d "%~dp0"

if not exist "node_modules" (
  echo [1/3] 首次启动，正在安装依赖...
  call npm install
)

if not exist "dist\index.html" (
  echo [2/3] 未检测到构建产物，正在构建前端页面...
  call npm run build
)

if not exist "TSP_Pro_Desktop.exe" (
  echo [3/3] 正在编译无边框独立桌面客户端 TSP_Pro_Desktop.exe ...
  call npm run desktop:build
)

start "" "%~dp0TSP_Pro_Desktop.exe"
exit /b 0
