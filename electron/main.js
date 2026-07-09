const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;
let runtimeProcess;

const BACKEND_PORT = process.env.BACKEND_PORT || 8080;
const RUNTIME_PORT = process.env.TOOL_RUNTIME_PORT || 8090;

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
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : false,
  });

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const isWindows = process.platform === 'win32';
  const pythonCmd = isWindows ? 'python' : 'python3';

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

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });
  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend] ${data.toString().trim()}`);
  });
  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err.message);
  });
  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
  });
}

function startToolRuntime() {
  const runtimeDir = path.join(__dirname, '..', 'tool_runtime');
  const isWindows = process.platform === 'win32';
  const pythonCmd = isWindows ? 'python' : 'python3';

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

  runtimeProcess.stdout?.on('data', (data) => {
    console.log(`[ToolRuntime] ${data.toString().trim()}`);
  });
  runtimeProcess.stderr?.on('data', (data) => {
    console.error(`[ToolRuntime] ${data.toString().trim()}`);
  });
  runtimeProcess.on('error', (err) => {
    console.error('Failed to start tool runtime:', err.message);
  });
  runtimeProcess.on('exit', (code) => {
    console.log(`Tool runtime exited with code ${code}`);
  });
}

function stopProcesses() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (runtimeProcess) {
    runtimeProcess.kill();
    runtimeProcess = null;
  }
}

app.whenReady().then(() => {
  startToolRuntime();
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopProcesses();
});

ipcMain.handle('get-backend-url', () => {
  return `http://127.0.0.1:${BACKEND_PORT}`;
});

ipcMain.handle('get-runtime-url', () => {
  return `http://127.0.0.1:${RUNTIME_PORT}`;
});
