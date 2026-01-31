@echo off
chcp 65001 >nul
REM Kiro API Server startup script (with proxy)
REM Usage: start-with-proxy.bat [proxy_url]
REM Example: start-with-proxy.bat http://127.0.0.1:7890

setlocal

REM Default proxy address
set DEFAULT_PROXY=http://127.0.0.1:7890

REM Use the provided proxy address or default value
if "%~1"=="" (
    set PROXY_URL=%DEFAULT_PROXY%
) else (
    set PROXY_URL=%~1
)

echo ==========================================
echo   Kiro API Server Startup Script
echo ==========================================
echo.
echo Proxy address: %PROXY_URL%
echo.

REM Set proxy environment variables
set HTTP_PROXY=%PROXY_URL%
set HTTPS_PROXY=%PROXY_URL%
set http_proxy=%PROXY_URL%
set https_proxy=%PROXY_URL%

REM Optional: Set addresses that bypass the proxy
set NO_PROXY=localhost,127.0.0.1,::1
set no_proxy=localhost,127.0.0.1,::1

echo Environment variables set:
echo   HTTP_PROXY=%HTTP_PROXY%
echo   HTTPS_PROXY=%HTTPS_PROXY%
echo   NO_PROXY=%NO_PROXY%
echo.

REM Change to the script's directory
cd /d "%~dp0"

echo Starting server...
echo.

REM Start the server
node src/server.js

endlocal
