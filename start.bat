@echo off
echo ============================================
echo   ManusAgent - Starting...
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo First time setup needed. Running install...
    call install.bat
)

echo Starting ManusAgent...
echo Backend will be on http://127.0.0.1:8080
echo Electron window will open shortly.
echo.

call npm run electron:dev
