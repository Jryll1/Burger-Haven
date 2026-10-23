@echo off
setlocal
set "APP_DIR=%~dp0Burger_Haven_App"
if not exist "%APP_DIR%\START_BURGER_HAVEN.bat" (
  echo Could not find Burger_Haven_App\START_BURGER_HAVEN.bat.
  echo Extract the complete ZIP before running this launcher.
  pause
  exit /b 1
)
call "%APP_DIR%\START_BURGER_HAVEN.bat"
