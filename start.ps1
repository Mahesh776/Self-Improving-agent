#Requires -Version 5.1
param(
    [switch]$InstallOnly,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

Write-Host ""
Write-Host "ManusAgent Launcher" -ForegroundColor White

Write-Step "Checking prerequisites"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python not found. Install from https://python.org"
}
Write-Ok "Python found"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js not found. Install from https://nodejs.org"
}
Write-Ok "Node.js found"

Write-Step "Setting up Python environment"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    & python -m venv .venv
    Write-Ok "Created virtual environment"
}

Write-Ok "Installing Python packages"
& .\.venv\Scripts\pip.exe install -r backend\requirements.txt -q 2>&1 | Out-Null
& .\.venv\Scripts\pip.exe install -r tool_runtime\requirements.txt -q 2>&1 | Out-Null

Write-Step "Creating directories"
@("backend\staging", "backend\custom_tools", "backend\staging\persona", "logs") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
Write-Ok "Directories ready"

Write-Step "Setting up .env"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Ok "Created .env - edit it and add your API keys!"
} else {
    Write-Ok ".env already exists"
}

if ($InstallOnly) {
    Write-Ok "Install complete. Run .\start.ps1 to start."
    exit 0
}

Write-Step "Installing Node.js dependencies"
if (-not (Test-Path "node_modules")) {
    & npm install
} else {
    Write-Ok "node_modules exists"
}

Write-Step "Starting ManusAgent"
Write-Ok "Backend: http://127.0.0.1:8080"
Write-Ok "Tool Runtime: http://127.0.0.1:8090"
Write-Host ""

& npm run electron:dev
