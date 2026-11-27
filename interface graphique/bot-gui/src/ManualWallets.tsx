import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Snapshot, BotLogEntry, WalletRanking } from "./types";

type Mode = "observe" | "paper";
type WalletLists = { observed: string[]; paper: string[] };

const short = (value: string) => value.length > 16 ? value.slice(0, 7) + "…" + value.slice(-6) : value;
const asset = (mint: string) => mint === "So11111111111111111111111111111111111111112" ? "SOL" :
  mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : short(mint);

function selectionReasons(wallet: WalletRanking): string[] {
  const reasons: string[] = [];
  if (!wallet.eligible) reasons.push("Échantillon insuffisant : moins de 10 ventes rapprochées ou moins de 3 jours actifs.");
  if (wallet.status === "negative_history") reasons.push("Historique global négatif.");
  if (wallet.status === "breakeven") reasons.push("Historique à l'équilibre : rentabilité positive absente.");
  if (wallet.reliabilityScore === null || wallet.reliabilityScore < 65) reasons.push("Score de fiabilité inférieur à 65/100.");
  if (wallet.closedTradeCount14d < 30) reasons.push("Moins de 30 ventes clôturées sur les 14 derniers jours.");
  if (wallet.medianTradePnlRaw === null) reasons.push("Médiane du P&L indisponible.");
  else if (BigInt(wallet.medianTradePnlRaw) <= 0n) reasons.push("P&L médian par vente non positif.");
  if (wallet.medianHoldingSeconds === null) reasons.push("Durée médiane de détention indisponible.");
  else if (wallet.medianHoldingSeconds < 10) reasons.push("Durée médiane de détention inférieure à 10 secondes.");
  if (wallet.maxProfitConcentrationPercent > 50) reasons.push("Plus de 50 % des profits proviennent d'une seule vente.");
  if (BigInt(wallet.grossProfitRaw) <= 0n) reasons.push("Aucun profit brut positif.");
  else if (BigInt(wallet.maxDrawdownRaw) * 100n > BigInt(wallet.grossProfitRaw) * 50n) reasons.push("Drawdown supérieur à 50 % des profits bruts.");
  if (wallet.eligible && wallet.status === "positive_history" && (wallet.reliabilityScore ?? 0) >= 65 && reasons.length === 0) reasons.push("Critères automatiques remplis. La sélection finale reste limitée aux 10 meilleurs wallets.");
  return reasons;
}

export default function ManualWallets() {
  const [wallet, setWallet] = useState("");
  const [mode, setMode] = useState<Mode>("observe");
  const [lists, setLists] = useState<WalletLists>({ observed: [], paper: [] });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      if (!window.botDashboard) throw new Error("Cette fonction nécessite l'application Electron.");
      const [walletLists, data, botLogs] = await Promise.all([
        window.botDashboard.getManualWallets(),
        window.botDashboard.getSnapshot(),
        window.botDashboard.getBotLogs(),
      ]);
      setLists(walletLists);
      setSnapshot(data);
      setLogs(botLogs);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les wallets.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      await window.botDashboard!.addManualWallet({ wallet: wallet.trim(), mode });
      setWallet("");
      await refresh();
      setNotice(mode === "observe"
        ? "Wallet ajouté à la surveillance. Redémarre le bot pour appliquer l'abonnement."
        : "Wallet ajouté à la sélection manuelle Paper Trading. La prise en compte est automatique.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'ajouter ce wallet.");
    } finally { setSaving(false); }
  };

  const remove = async (target: string, targetMode: Mode) => {
    setSaving(true); setError(""); setNotice("");
    try {
      await window.botDashboard!.removeManualWallet({ wallet: target, mode: targetMode });
      await refresh();
      setNotice(targetMode === "observe"
        ? "Wallet retiré de la surveillance. Redémarre le bot pour appliquer le changement."
        : "Wallet retiré de la sélection manuelle Paper Trading.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de retirer ce wallet.");
    } finally { setSaving(false); }
  };

  const diagnostics = useMemo(() => (snapshot?.rankings ?? []).map(item => ({ item, reasons: selectionReasons(item) })), [snapshot]);
  const securityEvents = useMemo(() => logs.filter(entry => /sécurité|liquidité minimale|token non autorisé|security|liquidity/i.test(entry.message)).slice(-30).reverse(), [logs]);
  const query = filter.trim().toLowerCase();
  const visibleDiagnostics = diagnostics.filter(({ item }) => !query || item.wallet.toLowerCase().includes(query) || item.quoteMint.toLowerCase().includes(query));

  return <>
    <Panel title="Ajouter un wallet manuellement">
      <form className="manual-wallet-form" onSubmit={add}>
        <label className="manual-wallet-input"><span>Adresse publique Solana</span><input value={wallet} onChange={event => setWallet(event.target.value)} placeholder="Colle l'adresse du wallet…" spellCheck={false} required /></label>
        <label className="manual-wallet-mode"><span>Mode</span><select value={mode} onChange={event => setMode(event.target.value as Mode)}><option value="observe">Observation / test</option><option value="paper">Copie Paper Trading forcée</option></select></label>
        <button className="bot-start" type="submit" disabled={saving || !wallet.trim()}>{saving ? "Enregistrement…" : "Ajouter le wallet"}</button>
      </form>
      <p className="muted manual-wallet-help">{mode === "observe"
        ? "Surveille les transactions de cette adresse et analyse les tokens détectés. Un redémarrage du bot est nécessaire."
        : "Force la sélection de ce wallet pour les simulations issues du flux DEX. Ne contourne jamais les contrôles de sécurité des tokens, la liquidité minimale de 20 000 $ ni les limites de risque Paper Trading."}</p>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="settings-success">{notice}</div>}
      {loading ? <div className="settings-loading">Chargement…</div> : <div className="manual-wallet-lists">
        <div><h3>Observation / test <span>{lists.observed.length}</span></h3>
          {lists.observed.length ? lists.observed.map(value => <div className="manual-wallet-row" key={"o"+value}><code>{value}</code><button className="text-button" disabled={saving} onClick={() => void remove(value, "observe")}>Retirer</button></div>) : <p className="muted">Aucun wallet ajouté.</p>}
        </div>
        <div><h3>Sélection Paper Trading manuelle <span>{lists.paper.length}</span></h3>
          {lists.paper.length ? lists.paper.map(value => <div className="manual-wallet-row" key={"p"+value}><code>{value}</code><button className="text-button" disabled={saving} onClick={() => void remove(value, "paper")}>Retirer</button></div>) : <p className="muted">Aucun wallet forcé manuellement.</p>}
        </div>
      </div>}
    </Panel>
    <Panel title="Diagnostic de sélection automatique">
      <p className="muted">Les raisons sont calculées à partir des seuils réellement appliqués au classement. Un wallet forcé manuellement peut apparaître ici comme non éligible : cela ne l'autorise jamais à contourner la sécurité des tokens ou les limites Paper Trading.</p>
      <input aria-label="Filtrer les diagnostics" placeholder="Filtrer par adresse ou actif…" value={filter} onChange={event => setFilter(event.target.value)} />
      {visibleDiagnostics.length ? <div className="wallet-diagnostics">{visibleDiagnostics.map(({ item, reasons }) => <article className="wallet-diagnostic" key={item.wallet + item.quoteMint}>
        <div className="wallet-diagnostic-head"><b className="mono">{short(item.wallet)}</b><span>{asset(item.quoteMint)}</span><strong>{item.reliabilityScore === null ? "—" : item.reliabilityScore + "/100"}</strong></div>
        <div className="wallet-diagnostic-stats"><span>{item.matchedSellCount} ventes · {item.activeDays} jours actifs</span><span>{item.closedTradeCount14d} ventes / 14 j</span><span>Win rate {item.winRatePercent.toFixed(1)} %</span></div>
        <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      </article>)}</div> : <p className="muted">Aucun classement ne correspond au filtre. Les diagnostics apparaîtront après le calcul des performances.</p>}
    </Panel>
    <Panel title="Refus de sécurité récents">
      <p className="muted">Événements de sécurité présents dans les 300 dernières lignes de journal du processus. Les contrôles sont faits token par token ; un wallet manuel n'y déroge jamais.</p>
      {securityEvents.length ? securityEvents.map((entry, index) => <div className="activity-row" key={entry.at + index}><span className="pill gray">{new Date(entry.at).toLocaleTimeString("fr-FR")}</span><div><b>{entry.message.slice(0, 240)}</b><small>{new Date(entry.at).toLocaleDateString("fr-FR")}</small></div></div>) : <p className="muted">Aucun refus de sécurité récent dans les journaux chargés. Cela ne signifie pas que les tokens sont approuvés : chaque token est contrôlé au moment du trade.</p>}
    </Panel>
  </>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2></div>{children}</section>;
}
