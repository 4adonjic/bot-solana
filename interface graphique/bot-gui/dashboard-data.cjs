const fs = require('node:fs/promises');
const path = require('node:path');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return fallback; throw error; }
}

async function readJsonLines(file) {
  try {
    const content = await fs.readFile(file, 'utf8');
    return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error('JSON invalide dans ' + path.basename(file) + ', ligne ' + (index + 1)); }
    });
  } catch (error) { if (error && error.code === 'ENOENT') return []; throw error; }
}

async function loadDashboardSnapshot(directory) {
  const [candidateData, watchlistData, paperData, trades] = await Promise.all([
    readJson(path.join(directory, 'wallet-candidates.json'), { version: 1, wallets: {} }),
    readJson(path.join(directory, 'wallet-watchlist.json'), { version: 1, wallets: {} }),
    readJson(path.join(directory, 'paper-trading.json'), null),
    readJsonLines(path.join(directory, 'wallet-trades.jsonl')),
  ]);
  const candidates = candidateData && candidateData.wallets && typeof candidateData.wallets === 'object'
    ? Object.values(candidateData.wallets) : [];
  const watchlist = watchlistData && watchlistData.wallets && typeof watchlistData.wallets === 'object'
    ? Object.values(watchlistData.wallets) : [];
  const paper = paperData && paperData.version === 1 ? paperData : null;
  return {
    generatedAt: new Date().toISOString(), dataDirectory: directory,
    sources: { candidates: candidates.length > 0, trades: trades.length > 0, watchlist: watchlist.length > 0, paper: paper !== null },
    counts: {
      candidates: candidates.length, observedTrades: trades.length, trackedWallets: watchlist.length,
      activeWallets: watchlist.filter(x => x && x.active === true).length,
      paperFills: paper ? paper.fills.length : 0, openPositions: paper ? paper.positions.length : 0,
    },
    candidates: candidates.sort((a,b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))).slice(0,100),
    watchlist: watchlist.sort((a,b) => Number(b.active)-Number(a.active) || Number(b.reliabilityScore || 0)-Number(a.reliabilityScore || 0)),
    trades: trades.slice(-100).reverse(),
    paper: paper ? { balances: paper.balances, positions: paper.positions, fills: paper.fills.slice(-100).reverse() } : null,
  };
}

module.exports = { readJson, readJsonLines, loadDashboardSnapshot };
