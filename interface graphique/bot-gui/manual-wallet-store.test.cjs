const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readManualWallets, addManualWallet, removeManualWallet } = require('./manual-wallet-store.cjs');

test('adds, deduplicates, reloads and removes a valid manual Paper Trading wallet', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-wallets-'));
  const file = path.join(dir, 'data', 'manual-paper-wallets.json');
  const wallet = '11111111111111111111111111111111';
  try {
    assert.deepEqual(await readManualWallets(file), []);
    assert.deepEqual(await addManualWallet(file, wallet), [wallet]);
    assert.deepEqual(await addManualWallet(file, wallet), [wallet]);
    assert.deepEqual(await readManualWallets(file), [wallet]);
    assert.deepEqual(await removeManualWallet(file, wallet), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects invalid public keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-wallets-'));
  try { await assert.rejects(() => addManualWallet(path.join(dir, 'wallets.json'), 'invalid'), /Adresse Solana invalide/); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
