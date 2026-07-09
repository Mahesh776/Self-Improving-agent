const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;
let runtimeProcess;

const BACKEND_PORT = process.env.BACKEND_PORT || 8080;
const RUNTIME_PORT = process.env.TOOL_RUNTIME_PORT || 8090;

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ManusAgent',
    icon: path.join(__dirname, '..', 'public', 'vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0a0a0f',
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      mainWindow.loadURL('http://localhost:5173');
    }
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function startBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  backendProcess = spawn(pythonCmd, [
    '-m', 'uvicorn', 'app:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
  ], {
    cwd: backendDir,
    env: {
      ...process.env,
      TOOL_RUNTIME_URL: `http://127.0.0.1:${RUNTIME_PORT}`,
      BACKEND_PORT: String(BACKEND_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (d) => console.log(`[Backend] ${d.toString().trim()}`));
  backendProcess.stderr?.on('data', (d) => console.error(`[Backend] ${d.toString().trim()}`));
  backendProcess.on('error', (e) => console.error('Backend error:', e.message));
}

function startToolRuntime() {
  const runtimeDir = path.join(__dirname, '..', 'tool_runtime');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const toolsDir = path.join(__dirname, '..', 'backend', 'custom_tools');
  const venvPath = path.join(__dirname, '..', 'backend', '.tool_runtime_venv');

  runtimeProcess = spawn(pythonCmd, [
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', String(RUNTIME_PORT),
  ], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      TOOLS_DIR: toolsDir,
      VENV_PATH: venvPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runtimeProcess.stdout?.on('data', (d) => console.log(`[ToolRuntime] ${d.toString().trim()}`));
  runtimeProcess.stderr?.on('data', (d) => console.error(`[ToolRuntime] ${d.toString().trim()}`));
  runtimeProcess.on('error', (e) => console.error('ToolRuntime error:', e.message));
}

function stopProcesses() {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (runtimeProcess) { runtimeProcess.kill(); runtimeProcess = null; }
}

loadEnv();

app.whenReady().then(() => {
  startToolRuntime();
  setTimeout(() => startBackend(), 1000);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopProcesses();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopProcesses);

ipcMain.handle('get-backend-url', () => `http://127.0.0.1:${BACKEND_PORT}`);
ipcMain.handle('get-runtime-url', () => `http://127.0.0.1:${RUNTIME_PORT}`);
