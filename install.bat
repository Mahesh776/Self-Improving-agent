@echo off
echo ============================================
echo   ManusAgent - First Time Setup
echo ============================================
echo.

echo [1/4] Creating Python virtual environment...
python -m venv .venv
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [2/4] Installing Python dependencies...
call .venv\Scripts\activate.bat
pip install -r backend\requirements.txt
pip install -r tool_runtime\requirements.txt

echo [3/4] Creating runtime directories...
if not exist "backend\staging" mkdir backend\staging
if not exist "backend\custom_tools" mkdir backend\custom_tools
if not exist "backend\staging\persona" mkdir backend\staging\persona
if not exist "logs" mkdir logs

echo [4/4] Installing Node.js dependencies...
call npm install

echo.
echo ============================================
echo   Setup complete!
echo.
echo   Next steps:
echo   1. Copy .env.example to .env
echo   2. Add your API keys to .env
echo   3. Run start.bat
echo ============================================
pause
