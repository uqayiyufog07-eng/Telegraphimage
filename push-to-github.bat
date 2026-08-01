@echo off
chcp 65001 >nul
title Telegraph-Image 一键推送到 GitHub

echo ============================================
echo   Telegraph-Image 一键推送到 GitHub
echo ============================================
echo.

REM 检查是否在正确目录
if not exist ".git" (
    echo [错误] 当前目录不是 Git 仓库！
    echo 请将此脚本放在 Telegraphimage 项目根目录下运行。
    pause
    exit /b 1
)

REM 显示当前状态
echo [1/4] 检查当前状态...
git status --short
echo.

REM 添加所有更改
echo [2/4] 添加所有更改的文件...
git add .
echo.

REM 获取提交信息
set /p commit_msg=请输入提交说明（留空则使用默认值）: 
if "%commit_msg%"=="" set commit_msg=feat: 更新功能

REM 提交
echo [3/4] 提交更改...
git commit -m "%commit_msg%"
if errorlevel 1 (
    echo [提示] 没有需要提交的更改，继续推送...
)
echo.

REM 推送到 GitHub
echo [4/4] 推送到 GitHub...
echo.
echo 正在连接 GitHub，请稍候...
git push origin main

if errorlevel 1 (
    echo.
    echo [错误] 推送失败！可能原因：
    echo   1. 网络问题 - 请检查网络连接
    echo   2. 认证问题 - 请确保已配置 GitHub 凭据
    echo   3. 代理问题 - 如果使用代理，请检查 git config --global --get http.proxy
    echo.
    echo 手动解决方案：
    echo   git config --global credential.helper manager
    echo   或使用 SSH: git remote set-url origin git@github.com:uqayiyufog07-eng/Telegraphimage.git
    pause
    exit /b 1
)

echo.
echo ============================================
echo   推送成功！
echo   仓库地址: https://github.com/uqayiyufog07-eng/Telegraphimage
echo ============================================
echo.
pause
