const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { loadDashboardSnapshot } = require('./dashboard-data.cjs');
const { readSettings, saveSettings } = require('./settings-store.cjs');

const packagedBackendRoot = path.join(process.resourcesPath, 'backend');
const projectRoot = process.env.BOT_PROJECT_ROOT || (app.isPackaged
  ? packagedBackendRoot
  : path.resolve(__dirname, '..', '..'));
const runtimeDataDirectory = app.isPackaged ? app.getPath('userData') : projectRoot;
const dataDirectory = process.env.BOT_DATA_DIR || path.join(runtimeDataDirectory, 'data');
const backendEntry = path.join(projectRoot, 'dist', 'index.js');
const backendWorkingDirectory = runtimeDataDirectory;
const backendEnvFile = path.join(backendWorkingDirectory, '.env');
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
    throw new Error('Moteur introuvable. Réinstallez l’application ou reconstruisez le paquet Windows.');
  }
  if (app.isPackaged && !fs.existsSync(backendEnvFile)) {
    throw new Error('Configuration absente. Le fichier .env doit être placé dans le dossier de données de Solana Bot.');
  }

  botLogs = [];
  setBotStatus({ state: 'starting', pid: null, startedAt: null, exitCode: null, message: 'Démarrage du moteur…' });
  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendWorkingDirectory,
    windowsHide: true,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !['RPC_HTTP_URL', 'RPC_WS_URL', 'LOG_LEVEL', 'TARGET_WALLETS', 'ENABLE_DEX_DISCOVERY', 'ENABLE_PAPER_TRADING', 'JUPITER_API_KEY'].includes(key))),
      ELECTRON_RUN_AS_NODE: '1',
      DOTENV_CONFIG_PATH: backendEnvFile,
    },
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
ipcMain.handle('settings:get', async () => readSettings(backendEnvFile));
ipcMain.handle('settings:save', async (_event, input) => ({
  settings: await saveSettings(backendEnvFile, input),
  restartRequired: true,
  botRunning: botStatus.state !== 'stopped',
}));
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
