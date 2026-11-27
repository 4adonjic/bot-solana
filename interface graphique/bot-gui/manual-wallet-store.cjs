const fs = require('node:fs/promises');
const path = require('node:path');
const { isSolanaPublicKey } = require('./settings-store.cjs');

async function readManualWallets(filePath) {
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.wallets)) {
    throw new Error('Fichier des wallets Paper Trading invalide.');
  }
  const wallets = [...new Set(parsed.wallets)];
  if (wallets.some(wallet => !isSolanaPublicKey(wallet))) throw new Error('Adresse invalide dans les wallets Paper Trading.');
  return wallets;
}

async function writeManualWallets(filePath, wallets) {
  if (!Array.isArray(wallets) || wallets.length > 100) throw new Error('Maximum 100 wallets Paper Trading manuels.');
  const normalized = [...new Set(wallets.map(wallet => String(wallet).trim()).filter(Boolean))];
  const invalid = normalized.find(wallet => !isSolanaPublicKey(wallet));
  if (invalid) throw new Error('Adresse Solana invalide : ' + invalid);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ version: 1, wallets: normalized }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
  return normalized;
}

async function addManualWallet(filePath, wallet) {
  const value = String(wallet || '').trim();
  if (!isSolanaPublicKey(value)) throw new Error('Adresse Solana invalide.');
  const wallets = await readManualWallets(filePath);
  if (!wallets.includes(value)) wallets.push(value);
  return writeManualWallets(filePath, wallets);
}

async function removeManualWallet(filePath, wallet) {
  const wallets = await readManualWallets(filePath);
  return writeManualWallets(filePath, wallets.filter(value => value !== wallet));
}

module.exports = { readManualWallets, writeManualWallets, addManualWallet, removeManualWallet };
