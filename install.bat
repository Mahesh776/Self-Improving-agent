@echo off
echo ============================================
echo   ManusAgent - First Time Setup
echo ============================================
echo.

echo [1/5] Creating Python virtual environment...
python -m venv .venv
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [2/5] Installing Python dependencies...
call .venv\Scripts\activate.bat
pip install -r backend\requirements.txt -q
pip install -r tool_runtime\requirements.txt -q

echo [3/5] Creating runtime directories...
if not exist "backend\staging" mkdir backend\staging
if not exist "backend\custom_tools" mkdir backend\custom_tools
if not exist "backend\staging\persona" mkdir backend\staging\persona
if not exist "logs" mkdir logs

echo [4/5] Setting up .env file...
if not exist ".env" (
    copy .env.example .env >nul
    echo     Created .env from .env.example
    echo     *** Edit .env and add your API keys before running! ***
) else (
    echo     .env already exists
)

echo [5/5] Installing Node.js dependencies...
call npm install

echo.
echo ============================================
echo   Setup complete!
echo.
echo   Next steps:
echo   1. Edit .env and add your API keys
echo   2. Run: start.bat
echo ============================================
pause
