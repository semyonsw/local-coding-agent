@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Always run from the folder where this script lives.
cd /d "%~dp0"

set "CHECK_ONLY=0"
if /I "%~1"=="--check" set "CHECK_ONLY=1"

rem Set OPEN_BROWSER=0 before running this script to disable auto-open.
if "%OPEN_BROWSER%"=="" set "OPEN_BROWSER=1"

echo [Start.bat] Project directory: %cd%

set "NODE_CMD="
set "USE_WSL_NODE=0"

where node >nul 2>&1
if not errorlevel 1 set "NODE_CMD=node"

if "%NODE_CMD%"=="" if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
if "%NODE_CMD%"=="" if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"
if "%NODE_CMD%"=="" if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_CMD=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if "%NODE_CMD%"=="" (
  where wsl.exe >nul 2>&1
  if not errorlevel 1 (
    wsl.exe sh -lc "command -v node >/dev/null 2>&1"
    if not errorlevel 1 set "USE_WSL_NODE=1"
  )
)

if "%NODE_CMD%"=="" if "%USE_WSL_NODE%"=="0" (
  echo [ERROR] Node.js was not found in Windows PATH or common install folders.
  echo [ERROR] WSL Node fallback is also unavailable.
  echo Install Node.js or ensure WSL has node installed.
  pause
  exit /b 1
)

if not "%NODE_CMD%"=="" (
  "%NODE_CMD%" --version >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Node command exists but failed to run: %NODE_CMD%
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [ERROR] .env file was not found in this folder.
  echo Create .env with: GEMINI_API_KEY="your_key"
  pause
  exit /b 1
)

findstr /R /I /C:"^[ ]*GEMINI_API_KEY[ ]*=" ".env" >nul
if errorlevel 1 (
  echo [ERROR] GEMINI_API_KEY is missing in .env
  echo Expected format: GEMINI_API_KEY="your_key"
  pause
  exit /b 1
)

if "%CHECK_ONLY%"=="1" (
  if "%USE_WSL_NODE%"=="1" (
    echo [OK] Preflight checks passed using WSL Node.
  ) else (
    echo [OK] Preflight checks passed using Windows Node.
  )
  exit /b 0
)

if "%OPEN_BROWSER%"=="1" (
  start "" "http://localhost:7789"
)

echo [Start.bat] Launching Gemini web agent...
echo [Start.bat] Press Ctrl+C to stop.
echo [Start.bat] Logs default to .\logs\gemini-web-YYYY-MM-DD.log
if "%GEMINI_ALLOW_OUTSIDE_ROOT%"=="" (
  echo [Start.bat] Outside-root file access: enabled by default
) else (
  echo [Start.bat] Outside-root file access from env: %GEMINI_ALLOW_OUTSIDE_ROOT%
)
echo.

if "%USE_WSL_NODE%"=="1" (
  for /f "delims=" %%I in ('wsl.exe wslpath "%cd%"') do set "WSL_DIR=%%I"
  if "!WSL_DIR!"=="" (
    echo [ERROR] Could not resolve WSL path for current directory.
    pause
    exit /b 1
  )
  wsl.exe sh -lc "cd \"!WSL_DIR!\" && node cc-mini.js gemini-web"
  set "EXIT_CODE=%ERRORLEVEL%"
) else (
  "%NODE_CMD%" cc-mini.js gemini-web
  set "EXIT_CODE=%ERRORLEVEL%"
)

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Gemini web agent exited with code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo [Start.bat] Server stopped normally.
pause
exit /b 0
