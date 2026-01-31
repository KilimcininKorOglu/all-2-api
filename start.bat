@echo off
chcp 65001 >nul
REM Kiro API Server startup script
REM Usage: start.bat

echo ==========================================
echo   Kiro API Server Startup Script
echo ==========================================
echo.

REM Change to the script's directory
cd /d "%~dp0\code"

echo Starting server...
echo.

REM Start the server
node src/server.js
