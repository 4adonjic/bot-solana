const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botDashboard', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('dashboard:get-snapshot'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  getBotStatus: () => ipcRenderer.invoke('bot:get-status'),
  getBotLogs: () => ipcRenderer.invoke('bot:get-logs'),
  startBot: () => ipcRenderer.invoke('bot:start'),
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  onBotStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('bot:status', listener);
    return () => ipcRenderer.removeListener('bot:status', listener);
  },
  onBotLog: callback => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('bot:log', listener);
    return () => ipcRenderer.removeListener('bot:log', listener);
  },
}));
