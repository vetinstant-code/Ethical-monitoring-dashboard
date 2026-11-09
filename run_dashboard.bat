@echo off
title VetInstant Local Diagnostic Dashboard Server
cd /d "%~dp0"

echo ============================================================
echo   VetInstant Diagnostic Dashboard ^& API Server
echo ============================================================
echo   Starting server at http://localhost:8765 ...
echo   Close this window to stop the server.
echo ============================================================
echo.

start "" "http://localhost:8765/index.html#/logs"

python local_diag_server.py --port 8765
pause
