import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type Mode = "observe" | "paper";
type WalletLists = { observed: string[]; paper: string[] };

export default function ManualWallets() {
  const [wallet, setWallet] = useState("");
  const [mode, setMode] = useState<Mode>("observe");
  const [lists, setLists] = useState<WalletLists>({ observed: [], paper: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      if (!window.botDashboard) throw new Error("Cette fonction nécessite l'application Electron.");
      setLists(await window.botDashboard.getManualWallets());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les wallets.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await window.botDashboard!.addManualWallet({ wallet: wallet.trim(), mode });
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

  return <Panel title="Ajouter un wallet manuellement">
    <form className="manual-wallet-form" onSubmit={add}>
      <label className="manual-wallet-input"><span>Adresse publique Solana</span><input value={wallet} onChange={event => setWallet(event.target.value)} placeholder="Colle l'adresse du wallet…" spellCheck={false} required /></label>
      <label className="manual-wallet-mode"><span>Mode</span><select value={mode} onChange={event => setMode(event.target.value as Mode)}><option value="observe">Observation / test</option><option value="paper">Copie Paper Trading forcée</option></select></label>
      <button className="bot-start" type="submit" disabled={saving || !wallet.trim()}>{saving ? "Enregistrement…" : "Ajouter le wallet"}</button>
    </form>
    <p className="muted manual-wallet-help">{mode === "observe"
      ? "Surveille les transactions de cette adresse et analyse les tokens détectés. Un redémarrage du bot est nécessaire."
      : "Force la sélection de ce wallet pour les simulations issues du flux DEX. Ne contourne jamais les contrôles de sécurité des tokens, la liquidité minimale ou les limites du portefeuille papier."}</p>
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
  </Panel>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2></div>{children}</section>;
}
