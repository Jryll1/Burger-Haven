@echo off
setlocal
cd /d "%~dp0"
title Burger Haven - Local Server

echo ========================================
echo    BURGER HAVEN - LOCAL STARTUP
echo ========================================
echo.
echo Project folder: %CD%

if not exist "app.py" (
  echo ERROR: app.py was not found.
  echo Open or extract the Burger_Haven_App folder, then run this file again.
  pause
  exit /b 1
)
if not exist "requirements.txt" (
  echo ERROR: requirements.txt was not found in this folder.
  pause
  exit /b 1
)

set "VENV_VERSION="
if exist ".venv\Scripts\python.exe" (
  for /f "delims=" %%V in ('".venv\Scripts\python.exe" -c "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))" 2^>nul') do set "VENV_VERSION=%%V"
)

if not "%VENV_VERSION%"=="3.13" (
  echo Setting up the project with Python 3.13...
  if exist ".venv" (
    echo Recreating the project's .venv folder only. Application files and database are preserved.
    rmdir /s /q ".venv"
  )
  py -3.13 -m venv .venv
  if errorlevel 1 goto :python_missing
)

if not exist ".venv\Scripts\python.exe" goto :setup_failed

echo.
echo Installing/checking Python dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :setup_failed

if not exist ".env" (
  echo Creating local .env from .env.example...
  copy /y ".env.example" ".env" >nul
)
if not exist ".env" goto :setup_failed

echo.
echo ========================================
echo Storefront: http://127.0.0.1:8000
echo Staff:      http://127.0.0.1:8000/admin
echo Analytics:  http://127.0.0.1:8000/analytics
echo ========================================
echo Keep this window open while using Burger Haven.
echo Press Ctrl+C to stop the server.
echo.
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000
if errorlevel 1 goto :server_failed
exit /b 0

:python_missing
echo.
echo ERROR: Python 3.13 was not found by the Windows Python launcher.
echo Install Python 3.13 (64-bit), then reopen this launcher.
echo Verify using: py -3.13 --version
pause
exit /b 1

:setup_failed
echo.
echo ERROR: Setup did not finish successfully. Read the message above.
pause
exit /b 1

:server_failed
echo.
echo ERROR: The server stopped or could not start.
echo If port 8000 is already in use, stop the other Burger Haven server first.
pause
exit /b 1
