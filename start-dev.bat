@echo off
echo 🧹 Cleaning up ports and starting development server...
echo.

REM Kill all Node.js processes
echo Terminating Node.js processes...
taskkill /IM node.exe /F >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo ✅ Node.js processes terminated
) else (
    echo ℹ️  No Node.js processes found
)

REM Wait for processes to terminate
timeout /t 2 /nobreak >nul

REM Check if port 3000 is free
echo Checking port 3000...
netstat -ano | findstr :3000 >nul
if %ERRORLEVEL% == 0 (
    echo ⚠️  Port 3000 is still in use, force cleaning...
    for /f "tokens=5" %%i in ('netstat -ano ^| findstr :3000') do (
        taskkill /PID %%i /F >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
) else (
    echo ✅ Port 3000 is available
)

echo.
echo 🚀 Starting development server...
echo Press Ctrl+C to stop the server
echo.

REM Start the development server
npm run dev

pause