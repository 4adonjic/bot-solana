const fs = require('node:fs/promises');
const path = require('node:path');

const KEYS = ['RPC_HTTP_URL', 'RPC_WS_URL', 'LOG_LEVEL', 'TARGET_WALLETS', 'ENABLE_DEX_DISCOVERY', 'ENABLE_PAPER_TRADING'];
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (match[2].trim().startsWith('"')) {
        try { value = JSON.parse(match[2].trim()); } catch { /* retain literal */ }
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function isSolanaPublicKey(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  while (number > 0n) { bytes += 1; number >>= 8n; }
  for (const char of value) { if (char !== '1') break; bytes += 1; }
  return bytes === 32;
}

function validateSettings(input) {
  const rpcHttpUrl = String(input.rpcHttpUrl || '').trim();
  const rpcWsUrl = String(input.rpcWsUrl || '').trim();
  const logLevel = String(input.logLevel || 'info').trim();
  const targetWallets = [...new Set(String(input.targetWallets || '').split(/[\s,;]+/).filter(Boolean))];
  const enableDexDiscovery = input.enableDexDiscovery === true;
  const enablePaperTrading = input.enablePaperTrading === true;
  let http;
  let ws;
  try { http = new URL(rpcHttpUrl); } catch { throw new Error('URL RPC HTTP invalide.'); }
  try { ws = new URL(rpcWsUrl); } catch { throw new Error('URL RPC WebSocket invalide.'); }
  if (!['http:', 'https:'].includes(http.protocol)) throw new Error('Le RPC HTTP doit utiliser http:// ou https://.');
  if (!['ws:', 'wss:'].includes(ws.protocol)) throw new Error('Le RPC WebSocket doit utiliser ws:// ou wss://.');
  if (!LEVELS.includes(logLevel)) throw new Error('Niveau de logs invalide.');
  if (targetWallets.length > 100) throw new Error('Maximum 100 wallets manuels.');
  const invalidWallet = targetWallets.find(wallet => !isSolanaPublicKey(wallet));
  if (invalidWallet) throw new Error('Adresse Solana invalide : ' + invalidWallet);
  if (!enableDexDiscovery && targetWallets.length === 0) throw new Error('Ajoute au moins un wallet ou active la découverte DEX.');
  if (enablePaperTrading && !enableDexDiscovery) throw new Error('Le Paper Trading nécessite la découverte DEX.');
  return { rpcHttpUrl, rpcWsUrl, logLevel, targetWallets, enableDexDiscovery, enablePaperTrading };
}

async function readSettings(envFile) {
  let source = '';
  try { source = await fs.readFile(envFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = parseEnv(source);
  return {
    rpcHttpUrl: values.RPC_HTTP_URL || '',
    rpcWsUrl: values.RPC_WS_URL || '',
    logLevel: LEVELS.includes(values.LOG_LEVEL) ? values.LOG_LEVEL : 'info',
    targetWallets: (values.TARGET_WALLETS || '').split(',').map(value => value.trim()).filter(Boolean).join('\n'),
    enableDexDiscovery: values.ENABLE_DEX_DISCOVERY === 'true',
    enablePaperTrading: values.ENABLE_PAPER_TRADING === 'true',
    configured: Boolean(values.RPC_HTTP_URL && values.RPC_WS_URL),
  };
}

async function saveSettings(envFile, input) {
  const settings = validateSettings(input);
  let source = '';
  try { source = await fs.readFile(envFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = parseEnv(source);
  values.RPC_HTTP_URL = settings.rpcHttpUrl;
  values.RPC_WS_URL = settings.rpcWsUrl;
  values.LOG_LEVEL = settings.logLevel;
  values.TARGET_WALLETS = settings.targetWallets.join(',');
  values.ENABLE_DEX_DISCOVERY = String(settings.enableDexDiscovery);
  values.ENABLE_PAPER_TRADING = String(settings.enablePaperTrading);
  const output = Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
  await fs.mkdir(path.dirname(envFile), { recursive: true });
  await fs.writeFile(envFile, output, { encoding: 'utf8', mode: 0o600 });
  return readSettings(envFile);
}

module.exports = { parseEnv, isSolanaPublicKey, validateSettings, readSettings, saveSettings };
