const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readJsonLines, loadDashboardSnapshot } = require('./dashboard-data.cjs');

test('loads the real persistent file formats used by the bot stores', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-gui-'));
  try {
    await fs.writeFile(path.join(dir, 'wallet-candidates.json'), JSON.stringify({ version: 1, wallets: {
      walletA: { wallet: 'walletA', firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-02T00:00:00.000Z', observationCount: 2, recentObservations: [], recentKeys: [] },
    } }));
    await fs.writeFile(path.join(dir, 'wallet-watchlist.json'), JSON.stringify({ version: 1, wallets: {
      '[\"walletA\",\"USDC\"]': { wallet: 'walletA', quoteMint: 'USDC', reliabilityScore: 80, firstSelectedAt: '2026-01-01T00:00:00.000Z', lastSelectedAt: '2026-01-02T00:00:00.000Z', selectionCount: 1, active: true, scoreHistory: [80], trend: 'stable' },
    } }));
    await fs.writeFile(path.join(dir, 'wallet-trades.jsonl'), JSON.stringify({ wallet: 'walletA', signature: 'sigA', mint: 'mintA', side: 'buy', observedAt: '2026-01-02T00:00:00.000Z' }) + '\n');
    await fs.writeFile(path.join(dir, 'paper-trading.json'), JSON.stringify({ version: 1, balances: {}, positions: [], fills: [
      { wallet: 'walletA', quoteMint: 'USDC', quoteAmountRaw: '100', feeQuoteRaw: '2', slippageBps: 250, side: 'buy' },
      { wallet: 'walletA', quoteMint: 'USDC', quoteAmountRaw: '120', feeQuoteRaw: '3', slippageBps: 300, side: 'sell', realizedPnlRaw: '15' },
    ] }));
    const snapshot = await loadDashboardSnapshot(dir);
    assert.equal(snapshot.counts.candidates, 1);
    assert.equal(snapshot.counts.trackedWallets, 1);
    assert.equal(snapshot.counts.activeWallets, 1);
    assert.equal(snapshot.counts.observedTrades, 1);
    assert.equal(snapshot.sources.paper, true);
    assert.deepEqual(snapshot.paper.performance.USDC, { realizedPnlRaw: '15', totalFeesRaw: '5', closedTrades: 1, wins: 1, losses: 0, slippageBpsTotal: 550, slippageSamples: 2, averageSlippageBps: 275 });
    assert.deepEqual(snapshot.paper.walletPerformance[0], {
      wallet: 'walletA', quoteMint: 'USDC', realizedPnlRaw: '15', totalFeesRaw: '5',
      buys: 1, sells: 1, closedTrades: 1, wins: 1, losses: 0,
      slippageBpsTotal: 550, slippageSamples: 2, averageSlippageBps: 275,
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('returns empty collections when data files do not exist', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-gui-empty-'));
  try {
    const snapshot = await loadDashboardSnapshot(dir);
    assert.equal(snapshot.counts.candidates, 0);
    assert.equal(snapshot.counts.trackedWallets, 0);
    assert.equal(snapshot.counts.observedTrades, 0);
    assert.equal(snapshot.paper, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects malformed JSONL instead of silently hiding corrupted history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-gui-invalid-'));
  try {
    const file = path.join(dir, 'bad.jsonl');
    await fs.writeFile(file, '{not json}\n');
    await assert.rejects(readJsonLines(file), /JSON invalide/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
