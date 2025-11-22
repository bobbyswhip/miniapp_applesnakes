@echo off
echo Starting AppleSnakes Dev Server...
echo.

REM Set Node.js path
set "PATH=C:\Program Files\nodejs;%PATH%"

REM Change to project directory
cd /d "%~dp0"

REM Check if node is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js or check your installation
    pause
    exit /b 1
)

REM Check if npm is available
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm not found in PATH
    pause
    exit /b 1
)

echo Node.js found:
node --version
echo npm found:
npm --version
echo.

echo Starting development server on port 3000...
echo.

npm run dev

pause
