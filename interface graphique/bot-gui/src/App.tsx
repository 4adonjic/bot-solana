import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Snapshot } from "./types";
import SettingsPage from "./Settings";
import ManualWallets from "./ManualWallets";

type Page = "overview" | "wallets" | "paper" | "activity" | "settings";
const nav: Array<{ id: Page; label: string; icon: string }> = [
  { id: "overview", label: "Vue générale", icon: "◫" },
  { id: "wallets", label: "Wallets", icon: "◎" },
  { id: "paper", label: "Paper Trading", icon: "▤" },
  { id: "activity", label: "Activité", icon: "⌁" },
  { id: "settings", label: "Paramètres", icon: "⚙" },
];
const short = (value?: string) => value ? value.slice(0, 6) + "…" + value.slice(-5) : "—";
const date = (value?: string) => value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";
const money = (raw?: string, decimals = 9) => {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
};
const asset = (mint: string) => mint === "So11111111111111111111111111111111111111112" ? "SOL" :
  mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : short(mint);
const decimals = (mint: string) => mint === "So11111111111111111111111111111111111111112" ? 9 : 6;
const signedMoney = (raw: string, places: number) => {
  if (!/^-?\d+$/.test(raw)) return "—";
  const value = Number(raw) / 10 ** places;
  return (value > 0 ? "+" : "") + value.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
};

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}
function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState("");
  const [botStatus, setBotStatus] = useState<{ state: "stopped" | "starting" | "running" | "stopping"; pid: number | null; startedAt: string | null; exitCode: number | null; message: string }>({ state: "stopped", pid: null, startedAt: null, exitCode: null, message: "État inconnu" });
  const [botLogs, setBotLogs] = useState<Array<{ at: string; source: string; message: string }>>([]);
  const [botActionError, setBotActionError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!window.botDashboard) throw new Error("Cette console doit être lancée avec l'application Electron.");
      const next = await window.botDashboard.getSnapshot();
      setSnapshot(next);
      setUpdated(new Date().toLocaleTimeString("fr-FR"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de lecture des données.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!window.botDashboard) return;
    void window.botDashboard.getBotStatus().then(setBotStatus).catch(() => undefined);
    void window.botDashboard.getBotLogs().then(setBotLogs).catch(() => undefined);
    const offStatus = window.botDashboard.onBotStatus(setBotStatus);
    const offLog = window.botDashboard.onBotLog(entry => setBotLogs(current => [...current.slice(-299), entry]));
    return () => { offStatus(); offLog(); };
  }, []);

  const controlBot = async (action: "start" | "stop") => {
    setBotActionError("");
    try {
      const status = action === "start" ? await window.botDashboard!.startBot() : await window.botDashboard!.stopBot();
      setBotStatus(status);
    } catch (e) {
      setBotActionError(e instanceof Error ? e.message : "Impossible de piloter le bot.");
    }
  };
  const activeCount = snapshot?.counts.activeWallets ?? 0;
  const recentFills = useMemo(() => snapshot?.paper?.fills.slice(-8).reverse() ?? [], [snapshot]);

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><b>SOLANA BOT</b><small>TRADING INTELLIGENCE</small></div></div>
      <div className="side-label">ESPACE DE TRAVAIL</div>
      <nav>{nav.map(item => <button key={item.id} className={page === item.id ? "nav-item selected" : "nav-item"} onClick={() => setPage(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{page === item.id && <i />}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> Mode simulation uniquement <small>Trading réel désactivé</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">CONSOLE / {nav.find(n => n.id === page)?.label.toUpperCase()}</div><h1>{nav.find(n => n.id === page)?.label}</h1></div>
        <div className="top-actions"><div className="connection"><span className={botStatus.state === "running" ? "status-dot" : "status-dot idle"} /> {botStatus.state === "running" ? "Bot en marche" : botStatus.state === "starting" ? "Démarrage…" : botStatus.state === "stopping" ? "Arrêt…" : "Bot arrêté"}</div>{botStatus.state === "running" || botStatus.state === "starting" ? <button className="bot-stop" onClick={() => void controlBot("stop")} disabled={botStatus.state !== "running"}>■ Arrêter</button> : <button className="bot-start" onClick={() => void controlBot("start")} disabled={botStatus.state === "stopping"}>▶ Lancer le bot</button>}<button className="refresh" onClick={() => void refresh()} disabled={loading}>{loading ? "Actualisation…" : "↻ Actualiser"}</button></div>
      </header>
      {error && <div className="alert">Lecture impossible : {error}</div>}{botActionError && <div className="alert">{botActionError}</div>}
      {!snapshot && loading && <Empty>Chargement des données du bot…</Empty>}
      {snapshot && <>
        {page === "overview" && <div className="content">
          <div className="welcome"><div><div className="eyebrow">CENTRE DE CONTRÔLE</div><h2>Vue d’ensemble du bot</h2><p>Surveille la découverte de wallets et les résultats de la simulation.</p></div><div className="live-tag"><span className="status-dot" /> SNAPSHOT LOCAL</div></div>
          <div className="metrics">
            <Metric label="Wallets détectés" value={snapshot.counts.candidates} note="Candidats enregistrés" />
            <Metric label="Wallets surveillés" value={snapshot.counts.trackedWallets} note={activeCount + " actifs actuellement"} />
            <Metric label="Fills simulés" value={snapshot.counts.paperFills} note="Exécutions virtuelles" />
            <Metric label="Positions ouvertes" value={snapshot.counts.openPositions} note="Portefeuille papier" />
          </div>
          <Panel title="Moteur du bot"><div className="engine-status"><div><span className={botStatus.state === "running" ? "status-dot" : "status-dot idle"} /> <b>{botStatus.message}</b><small>{botStatus.pid ? "Processus " + botStatus.pid : "Aucun processus actif"}</small></div><span className="pill gray">Paper Trading uniquement</span></div>{botLogs.length ? <div className="engine-logs">{botLogs.slice(-8).reverse().map((entry, i) => <div key={entry.at + i}><time>{new Date(entry.at).toLocaleTimeString("fr-FR")}</time><span className={entry.source === "error" ? "log-error" : ""}>{entry.message}</span></div>)}</div> : <Empty>Les journaux du moteur apparaîtront ici au démarrage.</Empty>}</Panel>
          <Panel title="Wallets sélectionnés" action={<button className="text-button" onClick={() => setPage("wallets")}>Voir les wallets →</button>}>
            {snapshot.watchlist.length ? <DataTable headers={["WALLET", "QUOTE", "FIABILITÉ", "TENDANCE", "ÉTAT"]}>
              {snapshot.watchlist.slice(0, 6).map((w, i) => <tr key={w.wallet + w.quoteMint}><td><span className="rank">{String(i + 1).padStart(2, "0")}</span><b className="mono">{short(w.wallet)}</b></td><td>{asset(w.quoteMint)}</td><td><span className="score">{w.reliabilityScore}<small>/100</small></span></td><td><span className={"trend " + w.trend}>{w.trend === "improving" ? "↗ En hausse" : w.trend === "declining" ? "↘ En baisse" : "→ Stable"}</span></td><td><span className={w.active ? "pill green" : "pill gray"}>{w.active ? "Actif" : "En pause"}</span></td></tr>)}
            </DataTable> : <Empty>Aucun wallet sélectionné pour le moment.</Empty>}
          </Panel>
          <div className="two-col"><Panel title="Dernières simulations">
            {recentFills.length ? recentFills.slice(0, 5).map((f, i) => <div className="activity-row" key={f.sourceSignature + i}><span className={f.side === "buy" ? "side buy" : "side sell"}>{f.side === "buy" ? "ACHAT" : "VENTE"}</span><div><b>{short(f.mint)}</b><small>{date(f.observedAt)}</small></div><strong>{money(f.quoteAmountRaw, f.quoteDecimals)} {asset(f.quoteMint)}</strong></div>) : <Empty>Aucun fill simulé.</Empty>}
          </Panel><Panel title="Sources de données">
            {Object.entries({ "Candidats": snapshot.sources.candidates, "Watchlist": snapshot.sources.watchlist, "Historique trades": snapshot.sources.trades, "Paper Trading": snapshot.sources.paper }).map(([name, ok]) => <div className="source-row" key={name}><span>{name}</span><span className={ok ? "source-ok" : "source-missing"}>{ok ? "Disponible" : "En attente"}</span></div>)}
          </Panel></div>
        </div>}
        {page === "wallets" && <div className="content">\n          <ManualWallets />
          <div className="metrics three"><Metric label="Candidats découverts" value={snapshot.counts.candidates} /><Metric label="Wallets suivis" value={snapshot.counts.trackedWallets} /><Metric label="Wallets actifs" value={activeCount} /></div>
          <Panel title="Watchlist automatique"><DataTable headers={["WALLET", "QUOTE", "SCORE", "TENDANCE", "SÉLECTIONS", "DERNIÈRE SÉLECTION", "ÉTAT"]}>
            {snapshot.watchlist.map(w => <tr key={w.wallet + w.quoteMint}><td className="mono">{short(w.wallet)}</td><td>{asset(w.quoteMint)}</td><td><span className="score">{w.reliabilityScore}<small>/100</small></span></td><td>{w.trend}</td><td>{w.selectionCount}</td><td>{date(w.lastSelectedAt)}</td><td><span className={w.active ? "pill green" : "pill gray"}>{w.active ? "Actif" : "En pause"}</span></td></tr>)}
          </DataTable>{!snapshot.watchlist.length && <Empty>La watchlist est vide.</Empty>}</Panel>
          <Panel title="Notes de tous les wallets évalués">
            <p className="muted">La note est indicative. Un score provisoire ne rend pas un wallet éligible au Paper Trading.</p>
            <DataTable headers={["WALLET", "QUOTE", "NOTE", "VENTES", "JOURS", "WIN RATE", "PNL BRUT", "STATUT"]}>
              {snapshot.rankings.map((w, i) => <tr key={w.wallet + w.quoteMint}>
                <td className="mono">{short(w.wallet)}</td><td>{asset(w.quoteMint)}</td>
                <td><span className="score">{w.reliabilityScore ?? "—"}<small>/100</small></span></td>
                <td>{w.matchedSellCount}</td><td>{w.activeDays}</td><td>{w.winRatePercent.toFixed(1)} %</td>
                <td>{w.realizedPnlRaw}</td>
                <td><span className={w.eligible && w.status === "positive_history" && (w.reliabilityScore ?? 0) >= 65 ? "pill green" : "pill gray"}>
                  {w.eligible ? (w.status === "positive_history" ? ((w.reliabilityScore ?? 0) >= 65 ? "Éligible" : "Score trop faible") : w.status === "negative_history" ? "Historique négatif" : "Équilibre") : "Données insuffisantes"}
                </span></td>
              </tr>)}
            </DataTable>
            {!snapshot.rankings.length && <Empty>Pas encore de performance calculable. Les notes apparaîtront dès que les trades auront des montants de cotation exacts.</Empty>}
          </Panel>
          <Panel title="Candidats repérés">
            <DataTable headers={["WALLET", "OBSERVATIONS", "PREMIÈRE DÉTECTION", "DERNIÈRE DÉTECTION"]}>
              {snapshot.candidates.map(c => <tr key={c.wallet}><td className="mono">{short(c.wallet)}</td><td>{c.observationCount}</td><td>{date(c.firstSeenAt)}</td><td>{date(c.lastSeenAt)}</td></tr>)}
            </DataTable>
            {!snapshot.candidates.length && <Empty>Aucun candidat enregistré. Vérifie la découverte DEX.</Empty>}
          </Panel>
        </div>}
        {page === "paper" && <div className="content">
          {!snapshot.paper ? <div className="alert">Aucun état Paper Trading trouvé. Active la simulation pour créer le portefeuille virtuel.</div> : <>
            <div className="metrics three"><Metric label="Fills enregistrés" value={snapshot.paper.fills.length} /><Metric label="Positions ouvertes" value={snapshot.paper.positions.length} /><Metric label="Trades observés" value={snapshot.counts.observedTrades} /></div>
            {Object.entries(snapshot.paper.performance).map(([mint, stats]) => <Panel key={mint} title={`Performance cumulée · ${asset(mint)}`}>
              <div className="metrics three">
                <Metric label="P&L réalisé net" value={signedMoney(stats.realizedPnlRaw, decimals(mint)) + " " + asset(mint)} note={stats.closedTrades + " ventes clôturées"} />
                <Metric label="Frais cumulés" value={money(stats.totalFeesRaw, decimals(mint)) + " " + asset(mint)} note="Achats et ventes simulés" />
                <Metric label="Taux de réussite" value={stats.closedTrades ? (stats.wins / stats.closedTrades * 100).toFixed(1) + " %" : "—"} note={stats.wins + " gagnants · " + stats.losses + " perdants"} />
                <Metric label="Slippage moyen simulé" value={stats.averageSlippageBps === null ? "—" : (stats.averageSlippageBps / 100).toFixed(2) + " %"} note={stats.slippageSamples + " fills mesurés"} />
              </div>
            </Panel>)}
            <Panel title="Performance par wallet copié"><p className="muted">Résultats réalisés de chaque wallet, regroupés par actif de cotation. Le P&L inclut les frais simulés.</p>
              {snapshot.paper.walletPerformance.length ? <DataTable headers={["WALLET", "QUOTE", "P&L RÉALISÉ NET", "FRAIS", "ACHATS", "VENTES", "TAUX DE RÉUSSITE", "SLIPPAGE MOYEN"]}>
                {snapshot.paper.walletPerformance.map(w => <tr key={w.wallet + w.quoteMint}>
                  <td className="mono">{short(w.wallet)}</td><td>{asset(w.quoteMint)}</td>
                  <td className={BigInt(w.realizedPnlRaw) >= 0n ? "source-ok" : "source-missing"}>{signedMoney(w.realizedPnlRaw, decimals(w.quoteMint))} {asset(w.quoteMint)}</td>
                  <td>{money(w.totalFeesRaw, decimals(w.quoteMint))} {asset(w.quoteMint)}</td>
                  <td>{w.buys}</td><td>{w.sells}</td>
                  <td>{w.closedTrades ? (w.wins / w.closedTrades * 100).toFixed(1) + " %" : "—"}</td>
                  <td>{w.averageSlippageBps === null ? "—" : (w.averageSlippageBps / 100).toFixed(2) + " %"}</td>
                </tr>)}
              </DataTable> : <Empty>Aucun wallet n’a encore de fill simulé.</Empty>}
            </Panel>
            <Panel title="Soldes virtuels"><div className="balance-grid">{Object.entries(snapshot.paper.balances).map(([mint, raw]) => <div className="balance-card" key={mint}><span>{asset(mint)}</span><strong>{money(raw, decimals(mint))}</strong><small>Solde disponible</small></div>)}</div></Panel>
            <Panel title="Positions ouvertes"><DataTable headers={["WALLET", "TOKEN", "QUANTITÉ BRUTE", "COÛT DE REVIENT"]}>
              {snapshot.paper.positions.map((p, i) => <tr key={p.wallet + p.mint + i}><td className="mono">{short(p.wallet)}</td><td className="mono">{short(p.mint)}</td><td>{p.tokenAmountRaw}</td><td>{money(p.costBasisRaw, decimals(p.quoteMint))} {asset(p.quoteMint)}</td></tr>)}
            </DataTable>{!snapshot.paper.positions.length && <Empty>Aucune position ouverte.</Empty>}</Panel>
            <Panel title="Historique des fills"><DataTable headers={["DATE", "SENS", "WALLET", "TOKEN", "MONTANT", "FRAIS"]}>
              {[...snapshot.paper.fills].reverse().map((f, i) => <tr key={f.sourceSignature + i}><td>{date(f.observedAt)}</td><td><span className={"side " + f.side}>{f.side === "buy" ? "ACHAT" : "VENTE"}</span></td><td className="mono">{short(f.wallet)}</td><td className="mono">{short(f.mint)}</td><td>{money(f.quoteAmountRaw, f.quoteDecimals)} {asset(f.quoteMint)}</td><td>{money(f.feeQuoteRaw, f.quoteDecimals)} {asset(f.quoteMint)}</td></tr>)}
            </DataTable>{!snapshot.paper.fills.length && <Empty>Aucune exécution simulée.</Empty>}</Panel>
          </>}
          <p className="disclaimer">Les montants sont issus du portefeuille virtuel. Aucun ordre réel n’est envoyé sur Solana.</p>
        </div>}
        {page === "activity" && <div className="content"><Panel title="Trades observés"><DataTable headers={["DATE", "SENS", "WALLET", "TOKEN", "SIGNATURE"]}>
          {[...snapshot.trades].reverse().map((t, i) => <tr key={t.signature + i}><td>{date(t.observedAt)}</td><td><span className={"side " + t.side}>{t.side === "buy" ? "ACHAT" : "VENTE"}</span></td><td className="mono">{short(t.wallet)}</td><td className="mono">{short(t.mint)}</td><td className="mono">{short(t.signature)}</td></tr>)}
        </DataTable>{!snapshot.trades.length && <Empty>Aucun trade enregistré.</Empty>}</Panel></div>}
        {page === "settings" && <SettingsPage botRunning={botStatus.state !== "stopped"} />}
      </>}
      <footer><span>Solana Bot Console <b>0.3.0</b> · Contrôle local</span><span>Dernière actualisation : {updated || "—"}</span></footer>
    </main>
  </div>;
}
