@echo off
title VetInstant Local Diagnostic Dashboard Server (Offline Mode)
cd /d "%~dp0"

echo ============================================================
echo   VetInstant Diagnostic Dashboard (OFFLINE CACHE-ONLY MODE)
echo ============================================================
echo   Starting offline server at http://localhost:8765 ...
echo   Close this window to stop the server.
echo ============================================================
echo.

start "" "http://localhost:8765/index.html#/logs"

python local_diag_server.py --port 8765 --offline
pause
