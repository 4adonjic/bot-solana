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

function summarizePaperFills(fills) {
  const summaries = new Map();
  for (const fill of fills) {
    if (!fill || typeof fill.quoteMint !== 'string' || !/^\d+$/.test(String(fill.feeQuoteRaw ?? ''))) continue;
    let summary = summaries.get(fill.quoteMint);
    if (!summary) {
      summary = { realizedPnlRaw: '0', totalFeesRaw: '0', closedTrades: 0, wins: 0, losses: 0, slippageBpsTotal: 0, slippageSamples: 0 };
      summaries.set(fill.quoteMint, summary);
    }
    summary.totalFeesRaw = (BigInt(summary.totalFeesRaw) + BigInt(fill.feeQuoteRaw)).toString();
    if (Number.isFinite(fill.slippageBps) && fill.slippageBps >= 0) {
      summary.slippageBpsTotal += fill.slippageBps;
      summary.slippageSamples += 1;
    }
    if (fill.side === 'sell' && /^-?\d+$/.test(String(fill.realizedPnlRaw ?? ''))) {
      const pnl = BigInt(fill.realizedPnlRaw);
      summary.realizedPnlRaw = (BigInt(summary.realizedPnlRaw) + pnl).toString();
      summary.closedTrades += 1;
      if (pnl > 0n) summary.wins += 1;
      else if (pnl < 0n) summary.losses += 1;
    }
  }
  return Object.fromEntries([...summaries.entries()].map(([mint, summary]) => [mint, {
    ...summary,
    averageSlippageBps: summary.slippageSamples ? summary.slippageBpsTotal / summary.slippageSamples : null,
  }]));
}

async function loadDashboardSnapshot(directory) {
  const [candidateData, watchlistData, paperData, rankingData, trades] = await Promise.all([
    readJson(path.join(directory, 'wallet-candidates.json'), { version: 1, wallets: {} }),
    readJson(path.join(directory, 'wallet-watchlist.json'), { version: 1, wallets: {} }),
    readJson(path.join(directory, 'paper-trading.json'), null),
    readJson(path.join(directory, 'wallet-rankings.json'), { version: 1, wallets: [] }),
    readJsonLines(path.join(directory, 'wallet-trades.jsonl')),
  ]);
  const candidates = candidateData && candidateData.version === 1 && candidateData.wallets && typeof candidateData.wallets === 'object'
    ? Object.values(candidateData.wallets) : [];
  const watchlist = watchlistData && watchlistData.version === 1 && watchlistData.wallets && typeof watchlistData.wallets === 'object'
    ? Object.values(watchlistData.wallets) : [];
  const rankings = rankingData && rankingData.version === 1 && Array.isArray(rankingData.wallets) ? rankingData.wallets : [];
  const paper = paperData && paperData.version === 1 && paperData.balances && Array.isArray(paperData.positions) && Array.isArray(paperData.fills)
    ? paperData : null;
  return {
    generatedAt: new Date().toISOString(), dataDirectory: directory,
    sources: { candidates: candidates.length > 0, rankings: rankings.length > 0, trades: trades.length > 0, watchlist: watchlist.length > 0, paper: paper !== null },
    counts: {
      candidates: candidates.length, evaluatedWallets: rankings.length, observedTrades: trades.length, trackedWallets: watchlist.length,
      activeWallets: watchlist.filter(x => x && x.active === true).length,
      paperFills: paper ? paper.fills.length : 0, openPositions: paper ? paper.positions.length : 0,
    },
    rankings: rankings.sort((a,b) => Number(b.eligible)-Number(a.eligible) || Number(b.reliabilityScore ?? -1)-Number(a.reliabilityScore ?? -1)),
    candidates: candidates.sort((a,b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))).slice(0,100),
    watchlist: watchlist.sort((a,b) => Number(b.active)-Number(a.active) || Number(b.reliabilityScore || 0)-Number(a.reliabilityScore || 0)),
    trades: trades.slice(-100).reverse(),
    paper: paper ? { balances: paper.balances, positions: paper.positions, performance: summarizePaperFills(paper.fills), fills: paper.fills.slice(-100).reverse() } : null,
  };
}

module.exports = { readJson, readJsonLines, loadDashboardSnapshot };
