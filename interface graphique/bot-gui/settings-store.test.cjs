const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isSolanaPublicKey, validateSettings, readSettings, saveSettings, addObservedWallet, removeObservedWallet } = require('./settings-store.cjs');

const valid = {
  rpcHttpUrl: 'https://rpc.example.com',
  rpcWsUrl: 'wss://rpc.example.com',
  logLevel: 'info',
  targetWallets: '11111111111111111111111111111111',
  enableDexDiscovery: false,
  enablePaperTrading: false,
};

test('validates a 32-byte Solana public key', () => {
  assert.equal(isSolanaPublicKey(valid.targetWallets), true);
  assert.equal(isSolanaPublicKey('not-a-wallet'), false);
});

test('rejects invalid RPC protocols and invalid wallet addresses', () => {
  assert.throws(() => validateSettings({ ...valid, rpcHttpUrl: 'ftp://example.com' }), /RPC HTTP/);
  assert.throws(() => validateSettings({ ...valid, targetWallets: 'bad-wallet' }), /Adresse Solana invalide/);
});

test('requires DEX discovery for Paper Trading and at least one discovery source', () => {
  assert.throws(() => validateSettings({ ...valid, enablePaperTrading: true }), /nécessite la découverte DEX/);
  assert.throws(() => validateSettings({ ...valid, targetWallets: '' }), /au moins un wallet/);
});

test('saves editable settings without dropping the Jupiter API key', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'solana-settings-'));
  const envFile = path.join(directory, '.env');
  try {
    await fs.writeFile(envFile, 'JUPITER_API_KEY="secret-value"\nCUSTOM_FLAG=keep\n', 'utf8');
    const saved = await saveSettings(envFile, { ...valid, enableDexDiscovery: true, enablePaperTrading: true, logLevel: 'debug' });
    assert.equal(saved.configured, true);
    assert.equal(saved.enablePaperTrading, true);
    const content = await fs.readFile(envFile, 'utf8');
    assert.match(content, /JUPITER_API_KEY="secret-value"/);
    assert.match(content, /CUSTOM_FLAG="keep"/);
    assert.doesNotMatch(JSON.stringify(saved), /secret-value/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('adds and removes observed wallets without disabling the last discovery source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'solana-observed-wallets-'));
  const envFile = path.join(directory, '.env');
  const first = '11111111111111111111111111111111';
  const second = 'So11111111111111111111111111111111111111112';
  try {
    await saveSettings(envFile, { ...valid, targetWallets: first });
    let settings = await addObservedWallet(envFile, second);
    assert.deepEqual(settings.targetWallets.split(/\\s+/).filter(Boolean), [first, second]);
    settings = await removeObservedWallet(envFile, first);
    assert.equal(settings.targetWallets, second);
    await assert.rejects(() => removeObservedWallet(envFile, second), /Active la découverte DEX/);
    await saveSettings(envFile, { ...settings, enableDexDiscovery: true, targetWallets: second });
    settings = await removeObservedWallet(envFile, second);
    assert.equal(settings.targetWallets, '');
    assert.equal(settings.enableDexDiscovery, true);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
