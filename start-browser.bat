@echo off
echo ============================================
echo   ManusAgent - Starting (Browser Mode)
echo ============================================
echo.

REM Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found
    pause
    exit /b 1
)

REM Check Node
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found
    pause
    exit /b 1
)

REM Setup venv if needed
if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
)

REM Install Python deps
echo Installing Python dependencies...
call .venv\Scripts\pip.exe install -r backend\requirements.txt -q 2>nul
call .venv\Scripts\pip.exe install -r tool_runtime\requirements.txt -q 2>nul

REM Create directories
if not exist "backend\staging" mkdir backend\staging
if not exist "backend\custom_tools" mkdir backend\custom_tools
if not exist "backend\staging\persona" mkdir backend\staging\persona
if not exist "logs" mkdir logs

REM Create .env if missing
if not exist ".env" (
    copy .env.example .env >nul 2>&1
    echo Created .env - please edit it and add your API keys!
    echo.
)

REM Start tool runtime
echo Starting Tool Runtime on port 8090...
start "ManusAgent-ToolRuntime" cmd /c "cd /d tool_runtime && ..\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8090"

REM Wait for tool runtime
timeout /t 2 /nobreak >nul

REM Start backend
echo Starting Backend on port 8080...
start "ManusAgent-Backend" cmd /c "cd /d backend && ..\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8080"

REM Wait for backend
timeout /t 3 /nobreak >nul

REM Start Vite dev server
echo Starting Frontend on port 5173...
echo.
echo ============================================
echo   ManusAgent is running!
echo.
echo   Open in browser: http://localhost:5173
echo   Backend API:     http://localhost:8080
echo   Tool Runtime:    http://localhost:8090
echo.
echo   Press any key to stop all services...
echo ============================================
echo.

REM Start vite in foreground so user can see output
call npx vite

REM When vite exits, kill the other services
taskkill /FI "WINDOWTITLE eq ManusAgent-ToolRuntime" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ManusAgent-Backend" /F >nul 2>&1
