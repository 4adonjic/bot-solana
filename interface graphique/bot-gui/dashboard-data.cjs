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
  const walletSummaries = new Map();
  for (const fill of fills) {
    if (!fill || typeof fill.quoteMint !== 'string' || !/^\d+$/.test(String(fill.feeQuoteRaw ?? ''))) continue;
    const walletKey = typeof fill.wallet === 'string' && fill.wallet.length > 0
      ? JSON.stringify([fill.wallet, fill.quoteMint]) : null;
    let walletSummary = walletKey ? walletSummaries.get(walletKey) : null;
    if (walletKey && !walletSummary) {
      walletSummary = { wallet: fill.wallet, quoteMint: fill.quoteMint, realizedPnlRaw: '0', totalFeesRaw: '0', buys: 0, sells: 0, closedTrades: 0, wins: 0, losses: 0, slippageBpsTotal: 0, slippageSamples: 0 };
      walletSummaries.set(walletKey, walletSummary);
    }
    let summary = summaries.get(fill.quoteMint);
    if (!summary) {
      summary = { realizedPnlRaw: '0', totalFeesRaw: '0', closedTrades: 0, wins: 0, losses: 0, slippageBpsTotal: 0, slippageSamples: 0 };
      summaries.set(fill.quoteMint, summary);
    }
    summary.totalFeesRaw = (BigInt(summary.totalFeesRaw) + BigInt(fill.feeQuoteRaw)).toString();
    if (walletSummary) {
      walletSummary.totalFeesRaw = (BigInt(walletSummary.totalFeesRaw) + BigInt(fill.feeQuoteRaw)).toString();
      if (fill.side === 'buy') walletSummary.buys += 1;
      if (fill.side === 'sell') walletSummary.sells += 1;
    }
    if (Number.isFinite(fill.slippageBps) && fill.slippageBps >= 0) {
      summary.slippageBpsTotal += fill.slippageBps;
      summary.slippageSamples += 1;
      if (walletSummary) {
        walletSummary.slippageBpsTotal += fill.slippageBps;
        walletSummary.slippageSamples += 1;
      }
    }
    if (fill.side === 'sell' && /^-?\d+$/.test(String(fill.realizedPnlRaw ?? ''))) {
      const pnl = BigInt(fill.realizedPnlRaw);
      summary.realizedPnlRaw = (BigInt(summary.realizedPnlRaw) + pnl).toString();
      summary.closedTrades += 1;
      if (pnl > 0n) summary.wins += 1;
      else if (pnl < 0n) summary.losses += 1;
      if (walletSummary) {
        walletSummary.realizedPnlRaw = (BigInt(walletSummary.realizedPnlRaw) + pnl).toString();
        walletSummary.closedTrades += 1;
        if (pnl > 0n) walletSummary.wins += 1;
        else if (pnl < 0n) walletSummary.losses += 1;
      }
    }
  }
  const byAsset = Object.fromEntries([...summaries.entries()].map(([mint, summary]) => [mint, {
    ...summary,
    averageSlippageBps: summary.slippageSamples ? summary.slippageBpsTotal / summary.slippageSamples : null,
  }]));
  const byWallet = [...walletSummaries.values()].map(summary => ({
    ...summary,
    averageSlippageBps: summary.slippageSamples ? summary.slippageBpsTotal / summary.slippageSamples : null,
  })).sort((a, b) => {
    if (a.quoteMint !== b.quoteMint) return a.quoteMint.localeCompare(b.quoteMint);
    const left = BigInt(a.realizedPnlRaw), right = BigInt(b.realizedPnlRaw);
    return left === right ? a.wallet.localeCompare(b.wallet) : left > right ? -1 : 1;
  });
  return { byAsset, byWallet };
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
  const paperPerformance = paper ? summarizePaperFills(paper.fills) : null;
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
    paper: paper ? { balances: paper.balances, positions: paper.positions, performance: paperPerformance.byAsset, walletPerformance: paperPerformance.byWallet, fills: paper.fills.slice(-100).reverse() } : null,
  };
}

module.exports = { readJson, readJsonLines, loadDashboardSnapshot };


async function auditDataDirectory(directory, now = Date.now()) {
  const files = [];
  const findings = [];
  const add = (severity, file, message) => findings.push({ severity, file, message });
  const minDate = Date.UTC(2009, 0, 1);
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    Date.parse(value) >= minDate && Date.parse(value) <= now + 5 * 60 * 1000;
  const raw = (value, signed = false) => typeof value === 'string' &&
    (signed ? /^-?\\d+$/.test(value) : /^\\d+$/.test(value));
  const readFileState = async (name, kind) => {
    const file = path.join(directory, name);
    try {
      const content = await fs.readFile(file, 'utf8');
      let value;
      if (kind === 'jsonl') {
        value = [];
        const lines = content.split(/\\r?\\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try { value.push({ item: JSON.parse(lines[i]), line: i + 1 }); }
          catch { add('error', name, 'JSON invalide ligne ' + (i + 1)); }
        }
      } else {
        try { value = JSON.parse(content); }
        catch { add('error', name, 'JSON invalide'); }
      }
      files.push({ name, status: findings.some(f => f.file === name && f.severity === 'error') ? 'error' : 'ok', detail: 'Présent · ' + (kind === 'jsonl' ? value.length + ' lignes exploitables' : 'JSON lisible') });
      return value;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        files.push({ name, status: 'missing', detail: 'Pas encore créé' });
        return null;
      }
      add('error', name, 'Lecture impossible');
      files.push({ name, status: 'error', detail: 'Lecture impossible' });
      return null;
    }
  };

  const tradeRows = await readFileState('wallet-trades.jsonl', 'jsonl');
  if (Array.isArray(tradeRows)) {
    const keys = new Set();
    for (const { item, line } of tradeRows) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add('error', 'wallet-trades.jsonl', 'Enregistrement non objet ligne ' + line); continue; }
      const key = JSON.stringify([item.wallet, item.signature, item.mint]);
      if (keys.has(key)) add('warning', 'wallet-trades.jsonl', 'Doublon wallet/signature/mint ligne ' + line);
      keys.add(key);
      if (typeof item.wallet !== 'string' || !item.wallet || typeof item.signature !== 'string' || !item.signature ||
        typeof item.mint !== 'string' || !item.mint || !['buy', 'sell'].includes(item.side) ||
        !raw(item.tokenAmountRaw) || !Number.isSafeInteger(item.slot) || item.slot < 0 ||
        !Number.isInteger(item.tokenDecimals) || item.tokenDecimals < 0 || item.tokenDecimals > 18) {
        add('error', 'wallet-trades.jsonl', 'Champs de trade invalides ligne ' + line);
      }
      if (!validDate(item.observedAt)) add('warning', 'wallet-trades.jsonl', 'Date absente ou hors plage ligne ' + line);
      if (item.quoteAmountRaw !== undefined && !raw(item.quoteAmountRaw)) add('error', 'wallet-trades.jsonl', 'Montant quote invalide ligne ' + line);
    }
  }

  const candidates = await readFileState('wallet-candidates.json', 'json');
  if (candidates !== null) {
    if (!candidates || candidates.version !== 1 || !candidates.wallets || typeof candidates.wallets !== 'object' || Array.isArray(candidates.wallets)) {
      add('error', 'wallet-candidates.json', 'Format attendu version 1 avec objet wallets');
    } else for (const [wallet, item] of Object.entries(candidates.wallets)) {
      if (!item || item.wallet !== wallet || !Number.isSafeInteger(item.observationCount) || item.observationCount < 1 ||
        !Array.isArray(item.recentObservations) || !Array.isArray(item.recentKeys)) add('error', 'wallet-candidates.json', 'Structure invalide pour ' + wallet);
      else if (!validDate(item.firstSeenAt) || !validDate(item.lastSeenAt)) add('warning', 'wallet-candidates.json', 'Dates incohérentes pour ' + wallet);
    }
  }

  const rankings = await readFileState('wallet-rankings.json', 'json');
  if (rankings !== null && (!rankings || rankings.version !== 1 || !Array.isArray(rankings.wallets) || !validDate(rankings.generatedAt))) {
    add('error', 'wallet-rankings.json', 'Enveloppe de classement invalide');
  }

  const backfill = await readFileState('wallet-history-backfill.json', 'json');
  if (backfill !== null) {
    if (!backfill || backfill.version !== 1 || !backfill.wallets || typeof backfill.wallets !== 'object' || Array.isArray(backfill.wallets)) {
      add('error', 'wallet-history-backfill.json', 'Format de reprise invalide');
    } else for (const [wallet, item] of Object.entries(backfill.wallets)) {
      if (!item || !Number.isSafeInteger(item.scanned) || item.scanned < 0 || typeof item.complete !== 'boolean' ||
        (item.before !== undefined && typeof item.before !== 'string')) add('error', 'wallet-history-backfill.json', 'Progression invalide pour ' + wallet);
    }
  }

  const paper = await readFileState('paper-trading.json', 'json');
  if (paper !== null) {
    if (!paper || paper.version !== 1 || !paper.balances || typeof paper.balances !== 'object' ||
      !Array.isArray(paper.positions) || !Array.isArray(paper.fills)) add('error', 'paper-trading.json', 'Structure Paper Trading invalide');
    else {
      for (const [mint, balance] of Object.entries(paper.balances)) if (!raw(balance)) add('error', 'paper-trading.json', 'Solde invalide pour ' + mint);
      for (const position of paper.positions) {
        if (!position || typeof position.wallet !== 'string' || typeof position.mint !== 'string' ||
          typeof position.quoteMint !== 'string' || !raw(position.tokenAmountRaw) || !raw(position.costBasisRaw)) {
          add('error', 'paper-trading.json', 'Position invalide');
        } else if (BigInt(position.tokenAmountRaw) <= 0n || BigInt(position.costBasisRaw) <= 0n) {
          add('error', 'paper-trading.json', 'Position avec quantité ou coût nul/négatif');
        }
      }
      for (const fill of paper.fills) {
        if (!fill || typeof fill.wallet !== 'string' || typeof fill.sourceSignature !== 'string' ||
          typeof fill.mint !== 'string' || !['buy', 'sell'].includes(fill.side) ||
          typeof fill.quoteMint !== 'string' || !raw(fill.tokenAmountRaw) || !raw(fill.quoteAmountRaw) ||
          !raw(fill.feeQuoteRaw) || !Number.isInteger(fill.slippageBps) || !validDate(fill.observedAt) ||
          (fill.realizedPnlRaw !== undefined && !raw(fill.realizedPnlRaw, true))) add('error', 'paper-trading.json', 'Fill invalide');
      }
      if (paper.positions.length && !paper.fills.length) add('warning', 'paper-trading.json', 'Positions ouvertes sans fill enregistré');
    }
  }

  const watchlist = await readFileState('wallet-watchlist.json', 'json');
  if (watchlist !== null && (!watchlist || watchlist.version !== 1 || !watchlist.wallets ||
    typeof watchlist.wallets !== 'object' || Array.isArray(watchlist.wallets))) add('error', 'wallet-watchlist.json', 'Format de watchlist invalide');

  const manual = await readFileState('manual-paper-wallets.json', 'json');
  if (manual !== null && (!manual || manual.version !== 1 || !Array.isArray(manual.wallets) ||
    manual.wallets.some(wallet => typeof wallet !== 'string'))) add('error', 'manual-paper-wallets.json', 'Format des wallets manuels invalide');

  for (const file of files) {
    const related = findings.filter(f => f.file === file.name);
    if (related.some(f => f.severity === 'error')) file.status = 'error';
    else if (related.length) file.status = 'warning';
    file.findingCount = related.length;
  }
  return {
    generatedAt: new Date(now).toISOString(),
    checkedFiles: files.filter(file => file.status !== 'missing').length,
    files,
    findings,
    summary: {
      errors: findings.filter(f => f.severity === 'error').length,
      warnings: findings.filter(f => f.severity === 'warning').length,
      missing: files.filter(file => file.status === 'missing').length,
    },
  };
}

module.exports.auditDataDirectory = auditDataDirectory;
