const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { loadDashboardSnapshot } = require('./dashboard-data.cjs');

const dataDirectory = process.env.BOT_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 850, minHeight: 620,
    title: 'Solana Bot — Console', backgroundColor: '#090d18', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

ipcMain.handle('dashboard:get-snapshot', async () => loadDashboardSnapshot(dataDirectory));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
