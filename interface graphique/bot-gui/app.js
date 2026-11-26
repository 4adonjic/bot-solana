(() => {
  const labels = { overview: 'Vue générale', wallets: 'Wallets', paper: 'Paper Trading', status: 'État du bot', settings: 'Configuration' };
  const nav = document.getElementById('nav');
  const root = document.getElementById('content');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = value => value ? value.slice(0,6) + '…' + value.slice(-6) : '—';
  const date = value => value ? new Date(value).toLocaleString('fr-FR') : '—';
  const fmtRaw = (raw, decimals) => {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return '—';
    const places = Math.max(0, Math.min(18, Number(decimals || 0)));
    const n = BigInt(raw);
    if (!places) return n.toString();
    const scale = 10n ** BigInt(places);
    const fraction = (n % scale).toString().padStart(places,'0').slice(0,4).replace(/0+$/,'');
    return fraction ? (n / scale).toString() + '.' + fraction : (n / scale).toString();
  };
  const asset = mint => mint === 'So11111111111111111111111111111111111111112' ? 'SOL' :
    mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : short(mint);
  const empty = (cols, message) => '<tr><td colspan="' + cols + '" class="muted">' + esc(message) + '</td></tr>';
  const table = (heads, rows) => '<div class="table-wrap"><table><thead><tr>' + heads.map(x=>'<th>'+x+'</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  const card = (label, value) => '<article class="card"><small>'+label+'</small><strong>'+esc(value)+'</strong></article>';
  const panel = (title, body) => '<section class="panel"><h2>'+title+'</h2>'+body+'</section>';
  let snapshot = null;

  function route() {
    const page = (location.hash || '#overview').slice(1);
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    if (!snapshot) { root.innerHTML = '<p class="muted">Chargement des fichiers du bot…</p>'; return; }
    if (page === 'wallets') renderWallets();
    else if (page === 'paper') renderPaper();
    else if (page === 'status') renderStatus();
    else if (page === 'settings') renderSettings();
    else renderOverview();
  }

  function renderOverview() {
    const c = snapshot.counts;
    root.innerHTML = '<div class="cards">' +
      card('Wallets découverts',c.candidates) + card('Wallets actifs / suivis',c.activeWallets+' / '+c.trackedWallets) +
      card('Fills simulés',c.paperFills) + card('Positions ouvertes',c.openPositions) + '</div>' +
      '<p class="muted">Données réelles lues le '+esc(date(snapshot.generatedAt))+'</p>' +
      panel('Watchlist automatique',table(['Wallet','Fiabilité','Tendance','Statut'],snapshot.watchlist.slice(0,12).map(w=>'<tr><td title="'+esc(w.wallet)+'">'+esc(short(w.wallet))+'</td><td>'+esc(w.reliabilityScore)+'/100</td><td>'+esc(w.trend || 'stable')+'</td><td><span class="pill '+(w.active?'good':'off')+'">'+(w.active?'Actif':'En pause')+'</span></td></tr>').join('') || empty(4,'Aucun wallet sélectionné.'))) +
      '<p class="muted">Le PnL n’est pas estimé ici : seules les données de simulation vérifiables sont affichées.</p>';
  }

  function renderWallets() {
    root.innerHTML = '<div class="cards">'+card('Candidats découverts',snapshot.counts.candidates)+card('Wallets suivis',snapshot.counts.trackedWallets)+card('Wallets actifs',snapshot.counts.activeWallets)+'</div>' +
      panel('Watchlist Paper Trading',table(['Wallet','Score','Tendance','Sélections','Statut','Dernière sélection'],snapshot.watchlist.map(w=>'<tr><td title="'+esc(w.wallet)+'">'+esc(short(w.wallet))+'</td><td>'+esc(w.reliabilityScore)+'/100</td><td>'+esc(w.trend || 'stable')+'</td><td>'+esc(w.selectionCount)+'</td><td><span class="pill '+(w.active?'good':'off')+'">'+(w.active?'Actif':'En pause')+'</span></td><td>'+esc(date(w.lastSelectedAt))+'</td></tr>').join('') || empty(6,'Watchlist vide.'))) +
      panel('Wallets repérés',table(['Wallet','Observations','Première détection','Dernière détection'],snapshot.candidates.map(w=>'<tr><td title="'+esc(w.wallet)+'">'+esc(short(w.wallet))+'</td><td>'+esc(w.observationCount)+'</td><td>'+esc(date(w.firstSeenAt))+'</td><td>'+esc(date(w.lastSeenAt))+'</td></tr>').join('') || empty(4,'Aucun candidat. Vérifie que la découverte DEX est activée.')));
  }

  function renderPaper() {
    const p = snapshot.paper;
    if (!p) { root.innerHTML = '<div class="notice">Aucun fichier Paper Trading trouvé. Active la simulation pour créer ses données persistantes.</div>'; return; }
    const balances = Object.entries(p.balances).map(([mint,raw])=>'<div class="balance"><span>'+esc(asset(mint))+'</span><b>'+esc(fmtRaw(raw,mint==='So11111111111111111111111111111111111111112'?9:6))+' '+esc(asset(mint))+'</b></div>').join('') || '<p class="muted">Aucun solde.</p>';
    const positions = p.positions.map(x=>'<tr><td>'+esc(short(x.wallet))+'</td><td>'+esc(short(x.mint))+'</td><td>'+esc(x.tokenAmountRaw)+'</td><td>'+esc(fmtRaw(x.costBasisRaw,x.quoteMint==='So11111111111111111111111111111111111111112'?9:6))+' '+esc(asset(x.quoteMint))+'</td></tr>').join('') || empty(4,'Aucune position ouverte.');
    const fills = p.fills.map(x=>'<tr><td>'+esc(date(x.observedAt))+'</td><td>'+esc(x.side.toUpperCase())+'</td><td>'+esc(short(x.wallet))+'</td><td>'+esc(short(x.mint))+'</td><td>'+esc(fmtRaw(x.quoteAmountRaw,x.quoteDecimals))+' '+esc(asset(x.quoteMint))+'</td></tr>').join('') || empty(5,'Aucun fill simulé.');
    root.innerHTML = '<div class="cards">'+card('Fills simulés',p.fills.length)+card('Positions ouvertes',p.positions.length)+card('Transactions observées',snapshot.counts.observedTrades)+'</div>' +
      panel('Soldes virtuels','<div class="balances">'+balances+'</div>') +
      panel('Positions ouvertes',table(['Wallet','Token','Quantité brute','Coût d’achat'],positions)) +
      panel('Dernières exécutions simulées',table(['Date','Sens','Wallet','Token','Montant quote'],fills)) +
      '<div class="notice">Aucune valorisation de marché ni PnL inventé : les positions sont affichées avec leur coût de revient enregistré.</div>';
  }

  function renderStatus() {
    root.innerHTML = '<div class="cards">'+card('Processus moteur','Non déterminé')+card('Connexion RPC','Non exposée')+card('Paper Trading',snapshot.paper?'Données trouvées':'Aucune simulation')+'</div>' +
      '<div class="notice">Console actuellement en lecture seule. L’ancienne interface simulait des démarrages, des logs et un KILL-SWITCH qui ne contrôlaient aucun processus. Ces faux boutons ont été retirés. Un véritable contrôle sera ajouté seulement avec un canal sécurisé vers le moteur.</div>';
  }

  function renderSettings() {
    root.innerHTML = panel('Sources de données','<div class="balance"><span>Candidats</span><b>'+(snapshot.sources.candidates?'Présents':'Absents')+'</b></div><div class="balance"><span>Watchlist</span><b>'+(snapshot.sources.watchlist?'Présente':'Absente')+'</b></div><div class="balance"><span>Paper Trading</span><b>'+(snapshot.sources.paper?'Présent':'Absent')+'</b></div><p class="muted path">'+esc(snapshot.dataDirectory)+'</p>') +
      panel('Configuration moteur','<div class="notice">Les paramètres actifs sont définis par le fichier .env du moteur : RPC_HTTP_URL, RPC_WS_URL, TARGET_WALLETS, ENABLE_DEX_DISCOVERY et ENABLE_PAPER_TRADING. Cette page ne modifie pas ces valeurs.</div><div class="notice warning">Le trading réel n’est pas disponible. Aucun paramètre ne permet d’activer des transactions avec de vrais fonds.</div>');
  }

  async function refresh() {
    try {
      if (!window.botDashboard) throw new Error('Ouvre cette interface avec Electron, pas dans un navigateur.');
      snapshot = await window.botDashboard.getSnapshot();
      document.getElementById('load-error').textContent = '';
      route();
    } catch (error) {
      document.getElementById('load-error').textContent = 'Lecture impossible : ' + error.message;
    }
  }

  Object.entries(labels).forEach(([key,label]) => {
    const a = document.createElement('a'); a.href = '#'+key; a.dataset.page = key; a.textContent = label; nav.appendChild(a);
  });
  document.getElementById('refresh').addEventListener('click', refresh);
  window.addEventListener('hashchange', route);
  refresh();
})();
