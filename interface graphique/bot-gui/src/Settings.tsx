import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DesktopSettings } from "./types";

const emptySettings: DesktopSettings = {
  rpcHttpUrl: "",
  rpcWsUrl: "",
  logLevel: "info",
  targetWallets: "",
  enableDexDiscovery: false,
  enablePaperTrading: false,
  configured: false,
};

export default function SettingsPage({ botRunning }: { botRunning: boolean }) {
  const [settings, setSettings] = useState<DesktopSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    window.botDashboard?.getSettings()
      .then(value => { if (active) setSettings(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Impossible de lire la configuration."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = <K extends keyof DesktopSettings,>(key: K, value: DesktopSettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
    setNotice("");
    setError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!window.botDashboard) throw new Error("Cette fonction nécessite l'application Electron.");
      const result = await window.botDashboard.saveSettings({
        rpcHttpUrl: settings.rpcHttpUrl,
        rpcWsUrl: settings.rpcWsUrl,
        logLevel: settings.logLevel,
        targetWallets: settings.targetWallets,
        enableDexDiscovery: settings.enableDexDiscovery,
        enablePaperTrading: settings.enablePaperTrading,
      });
      setSettings(result.settings);
      setNotice(result.botRunning
        ? "Configuration enregistrée. Arrête puis relance le bot pour appliquer les changements."
        : "Configuration enregistrée. Les changements seront utilisés au prochain démarrage du bot.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Échec de l'enregistrement.");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="settings-loading">Chargement de la configuration…</div>;

  return <div className="content settings-page">
    <form onSubmit={save}>
      <section className="panel settings-panel">
        <div className="panel-head"><h2>Connexion Solana</h2><span className={settings.configured ? "pill green" : "pill gray"}>{settings.configured ? "Configuration présente" : "À configurer"}</span></div>
        <div className="settings-fields">
          <label className="settings-field"><span>RPC HTTP</span><input type="url" required placeholder="https://…" value={settings.rpcHttpUrl} onChange={event => update("rpcHttpUrl", event.target.value)} /><small>Adresse RPC utilisée pour lire la blockchain Solana.</small></label>
          <label className="settings-field"><span>RPC WebSocket</span><input type="url" required placeholder="wss://…" value={settings.rpcWsUrl} onChange={event => update("rpcWsUrl", event.target.value)} /><small>Connexion temps réel aux événements Solana.</small></label>
          <label className="settings-field"><span>Niveau de logs</span><select value={settings.logLevel} onChange={event => update("logLevel", event.target.value as DesktopSettings["logLevel"])}>{["trace","debug","info","warn","error","fatal"].map(level => <option key={level} value={level}>{level}</option>)}</select><small>« info » est conseillé pour une utilisation normale.</small></label>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head"><h2>Wallets surveillés</h2><span className="settings-count">{settings.targetWallets.split(/[\s,;]+/).filter(Boolean).length} / 100</span></div>
        <div className="settings-fields">
          <label className="settings-field"><span>Adresses Solana</span><textarea rows={5} spellCheck={false} placeholder={"Une adresse par ligne\nAdresse wallet…"} value={settings.targetWallets} onChange={event => update("targetWallets", event.target.value)} /><small>Un wallet par ligne, ou séparés par des virgules. Les adresses sont vérifiées avant sauvegarde.</small></label>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head"><h2>Modules du bot</h2></div>
        <div className="settings-toggles">
          <label className="settings-toggle"><div><b>Découverte DEX</b><small>Repère les transactions sur les programmes DEX et construit les statistiques des wallets.</small></div><input type="checkbox" checked={settings.enableDexDiscovery} onChange={event => { update("enableDexDiscovery", event.target.checked); if (!event.target.checked) update("enablePaperTrading", false); }} /></label>
          <label className={"settings-toggle " + (!settings.enableDexDiscovery ? "disabled" : "")}><div><b>Paper Trading</b><small>Simule les achats et ventes des wallets sélectionnés, sans envoyer de transaction réelle.</small></div><input type="checkbox" checked={settings.enablePaperTrading} disabled={!settings.enableDexDiscovery} onChange={event => update("enablePaperTrading", event.target.checked)} /></label>
        </div>
        <div className="security-note"><b>Protection permanente</b><p>Le mode réel n'existe pas. La simulation conserve les contrôles de sécurité du token, la liquidité minimale et les limites de risque déjà intégrées. Cette page ne permet pas de les contourner.</p></div>
      </section>

      {error && <div className="alert">{error}</div>}
      {notice && <div className="settings-success">{notice}</div>}
      {botRunning && <div className="settings-restart">Le bot est actuellement lancé. Toute modification sera prise en compte après son redémarrage.</div>}
      <div className="settings-actions"><span>La clé Jupiter existante est conservée et masquée. Attention : une clé fournisseur incluse dans une URL RPC reste visible dans son champ.</span><button className="bot-start" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer la configuration"}</button></div>
    </form>
  </div>;
}
