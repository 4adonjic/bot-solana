const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { loadDashboardSnapshot } = require('./dashboard-data.cjs');

const projectRoot = process.env.BOT_PROJECT_ROOT || path.resolve(__dirname, '..', '..');
const dataDirectory = process.env.BOT_DATA_DIR || path.join(projectRoot, 'data');
const backendEntry = path.join(projectRoot, 'dist', 'index.js');
const windows = new Set();
const MAX_LOG_LINES = 300;
let botProcess = null;
let botStatus = { state: 'stopped', pid: null, startedAt: null, exitCode: null, message: 'Bot arrêté' };
let botLogs = [];

function publish(channel, payload) {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setBotStatus(next) {
  botStatus = { ...botStatus, ...next };
  publish('bot:status', botStatus);
}

function appendLog(source, chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const entry = { at: new Date().toISOString(), source, message: line };
    botLogs.push(entry);
    if (botLogs.length > MAX_LOG_LINES) botLogs = botLogs.slice(-MAX_LOG_LINES);
    publish('bot:log', entry);
  }
}

function startBot() {
  if (botProcess && botStatus.state !== 'stopped') return botStatus;
  if (!fs.existsSync(backendEntry)) {
    throw new Error('Moteur non compilé. Depuis le dossier du bot, exécute npm.cmd run build.');
  }

  botLogs = [];
  setBotStatus({ state: 'starting', pid: null, startedAt: null, exitCode: null, message: 'Démarrage du moteur…' });
  const child = spawn(process.execPath, [backendEntry], {
    cwd: projectRoot,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  botProcess = child;
  child.stdout.on('data', chunk => appendLog('info', chunk));
  child.stderr.on('data', chunk => appendLog('error', chunk));
  child.once('spawn', () => setBotStatus({
    state: 'running', pid: child.pid ?? null, startedAt: new Date().toISOString(), message: 'Moteur démarré',
  }));
  child.once('error', error => {
    appendLog('error', error.message);
    botProcess = null;
    setBotStatus({ state: 'stopped', pid: null, message: 'Échec du démarrage : ' + error.message });
  });
  child.once('exit', (code, signal) => {
    botProcess = null;
    setBotStatus({
      state: 'stopped', pid: null, exitCode: code,
      message: signal ? 'Bot arrêté (' + signal + ')' : 'Bot arrêté (code ' + code + ')',
    });
  });
  return botStatus;
}

function stopBot() {
  if (!botProcess) {
    setBotStatus({ state: 'stopped', pid: null, message: 'Bot déjà arrêté' });
    return botStatus;
  }
  setBotStatus({ state: 'stopping', message: 'Arrêt du moteur…' });
  botProcess.kill();
  return botStatus;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 850, minHeight: 620,
    title: 'Solana Bot — Console', backgroundColor: '#090d18', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('bot:status', botStatus);
    for (const entry of botLogs) win.webContents.send('bot:log', entry);
  });
}

ipcMain.handle('dashboard:get-snapshot', async () => loadDashboardSnapshot(dataDirectory));
ipcMain.handle('bot:get-status', () => botStatus);
ipcMain.handle('bot:get-logs', () => botLogs);
ipcMain.handle('bot:start', () => startBot());
ipcMain.handle('bot:stop', () => stopBot());

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => {
  if (botProcess) botProcess.kill();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
