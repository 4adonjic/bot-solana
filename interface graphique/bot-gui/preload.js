const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botDashboard', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('dashboard:get-snapshot'),
}));
