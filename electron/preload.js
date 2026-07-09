const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getRuntimeUrl: () => ipcRenderer.invoke('get-runtime-url'),
  platform: process.platform,
});
