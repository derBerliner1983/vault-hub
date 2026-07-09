import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import {
  KeyRound, ShieldCheck, ArrowUpCircle, RefreshCw, CheckCircle2, Server, Package, Globe, Puzzle,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt, useI18n, LANGUAGES } from '../lib/i18n';
import { api } from '../lib/api';
import {
  fetchStore, fetchInstalledPlugins, installPlugin, useInstalledPlugins,
  type StoreItem, type PluginManifest,
} from '../lib/plugins';

type Tab = 'account' | 'extensions' | 'updates' | 'apps';

interface VersionInfo {
  current: string; latest: string | null; updateAvailable: boolean;
  behind: number; method: string; repo: string; releaseUrl: string;
  checkedAt: string; error?: string;
}

export function Settings() {
  const [tab, setTab] = useState<Tab>('account');
  return (
    <>
      <Topbar title={tt('Einstellungen')} />
      <div className="page">
        <RestartBanner />
        <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
          <TabBtn active={tab === 'account'} onClick={() => setTab('account')} icon={<KeyRound size={15} />} label={tt('Account')} />
          <TabBtn active={tab === 'extensions'} onClick={() => setTab('extensions')} icon={<Puzzle size={15} />} label={tt('Erweiterungen')} />
          <TabBtn active={tab === 'updates'} onClick={() => setTab('updates')} icon={<ArrowUpCircle size={15} />} label={tt('Version & Updates')} />
          <TabBtn active={tab === 'apps'} onClick={() => setTab('apps')} icon={<Package size={15} />} label={tt('Updatefähige Apps')} />
        </div>
        {tab === 'account' && <AccountPanel />}
        {tab === 'extensions' && <ExtensionsPanel />}
        {tab === 'updates' && <UpdatesPanel />}
        {tab === 'apps' && <AppUpdatesPanel />}
      </div>
    </>
  );
}

// Zeigt einen Hinweis, wenn ein nach dem Start installiertes Backend-Plugin
// einen Neustart braucht, und bietet den Neustart direkt an.
function RestartBanner() {
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [restarting, setRestarting] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await fetch('/api/plugins/restart-status', { credentials: 'include' });
      const d = await r.json();
      setPending(d.restartNeeded ? d.pending : []);
    } catch { /* */ }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const restart = async () => {
    setRestarting(true);
    try { await fetch('/api/settings/restart', { method: 'POST', credentials: 'include' }); } catch { /* Verbindung bricht erwartungsgemäß ab */ }
    // Warten, bis das Backend wieder erreichbar ist, dann neu laden.
    const waitUp = async (tries = 0): Promise<void> => {
      if (tries > 60) { window.location.reload(); return; }
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok) { window.location.reload(); return; }
      } catch { /* noch nicht oben */ }
      setTimeout(() => void waitUp(tries + 1), 1000);
    };
    setTimeout(() => void waitUp(), 1500);
  };

  if (pending.length === 0) return null;
  const names = pending.map((p) => p.name).join(', ');
  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--color-warning)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <RefreshCw size={18} style={{ color: 'var(--color-warning)' }} />
      <div style={{ flex: 1, fontSize: 13 }}>
        <b>{tt('Neustart erforderlich')}</b> — {tt('Ein neu installiertes Plugin-Backend wird erst nach einem Neustart aktiv')}: {names}
      </div>
      <button className="btn btn--primary btn--sm" onClick={restart} disabled={restarting}>
        <RefreshCw size={14} style={restarting ? { animation: 'spin 1s linear infinite' } : undefined} /> {restarting ? tt('Starte neu…') : tt('Backend neu starten')}
      </button>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="btn btn--ghost btn--sm"
      style={{ borderRadius: 0, borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`, color: active ? 'var(--color-fg)' : 'var(--color-subtle)', fontWeight: active ? 600 : 500 }}>
      {icon} {label}
    </button>
  );
}

// ─── Account: Passwort ändern + 2FA (Kern-Funktion) ──────────────────────────

function AccountPanel() {
  return (
    <div className="stats-grid">
      <PasswordCard />
      <TwoFactorCard />
      <LanguageCard />
    </div>
  );
}

// ─── Erweiterungen: System-Erweiterungen (Typ A) mit Dienst-Schalter/Panel ────

function ExtensionsPanel() {
  const { plugins, loading } = useInstalledPlugins();
  const exts = plugins.filter((p) => p.contributes?.serviceToggle || p.contributes?.settingsPanel);

  if (loading) return <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}><span className="spinner" /></div>;
  if (exts.length === 0) {
    return (
      <div className="card empty-state" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <Puzzle size={26} style={{ color: 'var(--color-accent)' }} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{tt('Keine System-Erweiterungen installiert')}</div>
        <div style={{ color: 'var(--color-subtle)', marginTop: 4 }}>{tt('Installiere z. B. „SSH-Zugang" aus dem Store, dann erscheint hier der Schalter.')}</div>
      </div>
    );
  }
  return <div className="stats-grid">{exts.map((p) => <ExtensionCard key={p.id} plugin={p} />)}</div>;
}

function ExtensionCard({ plugin }: { plugin: PluginManifest }) {
  const svc = plugin.contributes?.serviceToggle;
  const panel = plugin.contributes?.settingsPanel;
  const [active, setActive] = useState<boolean | null>(svc ? null : false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadStatus = useCallback(async () => {
    if (!svc) return;
    try {
      const r = await fetch(`/api/plugins/${plugin.id}/service`, { credentials: 'include' });
      const d = await r.json();
      setActive(!!d.active);
    } catch { setActive(false); }
  }, [plugin.id, svc]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const toggle = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/plugins/${plugin.id}/service`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !active }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Fehler');
      setActive(!!d.active);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <Puzzle size={16} /> {plugin.name}
        {svc && active !== null && (
          <span className={`badge ${active ? 'badge--running' : 'badge--stopped'}`} style={{ marginLeft: 'auto' }}>
            {active ? tt('Aktiv') : tt('Inaktiv')}
          </span>
        )}
      </div>
      {svc && (
        <>
          <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>{svc.label || svc.service}</div>
          <button className={`btn btn--sm ${active ? 'btn--danger' : 'btn--primary'}`} onClick={toggle} disabled={busy || active === null}>
            {active ? tt('Deaktivieren') : tt('Aktivieren')}
          </button>
        </>
      )}
      {panel?.ui?.startsWith('iframe:') && (
        <iframe title={plugin.name} src={panel.ui.slice('iframe:'.length)} style={{ width: '100%', height: 240, border: 0, borderRadius: 8 }} />
      )}
      {err && <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{err}</div>}
    </div>
  );
}

function LanguageCard() {
  const { lang, setLang } = useI18n();
  const change = (code: string) => {
    setLang(code);
    // tt-basierte Komponenten sind nicht reaktiv → einmal neu laden für sofortige Wirkung.
    setTimeout(() => window.location.reload(), 50);
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Globe size={16} /> {tt('Sprache')}</div>
      <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>
        {tt('Basis: Deutsch & Englisch. Weitere Sprachen kommen modular über den Store.')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {LANGUAGES.map((l) => (
          <button key={l.code} className={`btn btn--sm ${l.code === lang ? 'btn--primary' : 'btn--outline'}`} onClick={() => change(l.code)}>
            {l.flag ? `${l.flag} ` : ''}{l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMsg(null);
    if (next.length < 6) { setMsg({ ok: false, text: tt('Neues Passwort zu kurz (min. 6 Zeichen).') }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: tt('Passwörter stimmen nicht überein.') }); return; }
    setBusy(true);
    try {
      await api.auth.changePassword(cur, next);
      setMsg({ ok: true, text: tt('Passwort geändert.') });
      setCur(''); setNext(''); setConfirm('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : tt('Fehler beim Ändern.') });
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><KeyRound size={16} /> {tt('Passwort ändern')}</div>
      <input className="input" type="password" placeholder={tt('Aktuelles Passwort')} value={cur} onChange={(e) => setCur(e.target.value)} />
      <input className="input" type="password" placeholder={tt('Neues Passwort')} value={next} onChange={(e) => setNext(e.target.value)} />
      <input className="input" type="password" placeholder={tt('Neues Passwort bestätigen')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {msg && <div style={{ fontSize: 13, color: msg.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{msg.text}</div>}
      <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy || !cur || !next}>{tt('Speichern')}</button>
    </div>
  );
}

function TwoFactorCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState('');
  const [token, setToken] = useState('');
  const [disablePw, setDisablePw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try { const s = await api.auth.twoFactor.status(); setEnabled(s.enabled); } catch { setEnabled(false); }
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const startSetup = async () => {
    setMsg(''); setBusy(true);
    try {
      const s = await api.auth.twoFactor.setup();
      setSetup(s);
      const qrGen = qrcode(0, 'M'); qrGen.addData(s.otpauth); qrGen.make();
      setQr(qrGen.createDataURL(5));
    } catch (e) { setMsg(e instanceof Error ? e.message : tt('Fehler')); }
    finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    setMsg(''); setBusy(true);
    try { await api.auth.twoFactor.enable(token); setSetup(null); setToken(''); await loadStatus(); }
    catch (e) { setMsg(e instanceof Error ? e.message : tt('Code ungültig')); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setMsg(''); setBusy(true);
    try { await api.auth.twoFactor.disable(disablePw); setDisablePw(''); await loadStatus(); }
    catch (e) { setMsg(e instanceof Error ? e.message : tt('Fehler')); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <ShieldCheck size={16} /> {tt('Zwei-Faktor-Authentifizierung')}
        {enabled && <span className="badge badge--running" style={{ marginLeft: 'auto' }}>{tt('Aktiv')}</span>}
      </div>
      {enabled === null ? (
        <span className="spinner" />
      ) : enabled ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>{tt('2FA ist aktiv. Zum Deaktivieren Passwort eingeben.')}</div>
          <input className="input" type="password" placeholder={tt('Passwort')} value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
          <button className="btn btn--danger btn--sm" onClick={disable} disabled={busy || !disablePw}>{tt('2FA deaktivieren')}</button>
        </>
      ) : setup ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>{tt('QR-Code in der Authenticator-App scannen, dann 6-stelligen Code eingeben.')}</div>
          {qr && <img src={qr} alt="2FA QR" style={{ width: 160, height: 160, alignSelf: 'center', borderRadius: 8, background: '#fff', padding: 6 }} />}
          <input className="input" placeholder={tt('6-stelliger Code')} value={token} onChange={(e) => setToken(e.target.value)} maxLength={6} />
          <button className="btn btn--primary btn--sm" onClick={confirmEnable} disabled={busy || token.length !== 6}>{tt('Aktivieren')}</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>{tt('Zusätzliche Sicherheit per Authenticator-App (TOTP).')}</div>
          <button className="btn btn--primary btn--sm" onClick={startSetup} disabled={busy}>{tt('2FA einrichten')}</button>
        </>
      )}
      {msg && <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{msg}</div>}
    </div>
  );
}

// ─── Version & Updates: Grundsystem (git-basiert, wie Core-Hub) ───────────────

function UpdatesPanel() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try {
      const r = await fetch(`/api/settings/version${refresh ? '?refresh=1' : ''}`, { credentials: 'include' });
      setInfo(await r.json());
    } catch { /* offline */ }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(false); }, [check]);

  const runUpdate = () => {
    setUpdating(true); setLog([]);
    const es = new EventSource('/api/settings/update/stream', { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => setLog((l) => [...l, e.data]);
    es.onerror = () => { es.close(); setUpdating(false); void check(true); };
  };
  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}><Server size={20} /></div>
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Vault-Hub v{info?.current ?? '…'}</div>
          <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>
            {info?.repo ? `${tt('Repository')}: ${info.repo}` : ''}{info?.checkedAt ? ` · ${tt('geprüft')}: ${new Date(info.checkedAt).toLocaleTimeString()}` : ''}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {info && (info.updateAvailable
            ? <span className="badge badge--restarting">{tt('Update verfügbar')}{info.latest ? ` (${info.latest})` : ''}</span>
            : <span className="badge badge--running"><CheckCircle2 size={13} /> {tt('Aktuell')}</span>)}
          <button className="btn btn--outline btn--sm" onClick={() => check(true)} disabled={checking}>
            <RefreshCw size={14} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} /> {tt('Prüfen')}
          </button>
        </div>
      </div>

      {info?.error && <div style={{ fontSize: 13, color: 'var(--color-warning)' }}>{info.error}</div>}

      {info?.updateAvailable && (
        <button className="btn btn--primary" onClick={runUpdate} disabled={updating}>
          <ArrowUpCircle size={15} /> {updating ? tt('Aktualisiere…') : tt('Jetzt aktualisieren')}
        </button>
      )}

      {log.length > 0 && (
        <pre style={{ background: 'var(--color-surface-sunken)', borderRadius: 8, padding: 12, fontSize: 12, maxHeight: 260, overflow: 'auto', margin: 0 }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}

// ─── Updatefähige Apps: installierte Plugins mit verfügbarem Update ────────────

function AppUpdatesPanel() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [store, inst] = await Promise.all([fetchStore(), fetchInstalledPlugins()]);
    const instMap = new Map(inst.map((p) => [p.id, p.version]));
    // Nur installierte Apps mit verfügbarem Update.
    const updatable = store.items.filter((s) => instMap.has(s.id) && (s.updateAvailable || (instMap.get(s.id) !== s.version)));
    setItems(updatable);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, source?: string) => {
    setBusy(id);
    try { await installPlugin(id, source); await load(); } finally { setBusy(null); }
  };
  const updateAll = async () => {
    for (const it of items) { await update(it.id, it.source); }
  };

  if (loading) return <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}><span className="spinner" /></div>;

  if (items.length === 0) {
    return (
      <div className="card empty-state" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <CheckCircle2 size={28} style={{ color: 'var(--color-success)' }} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{tt('Alle Apps sind aktuell')}</div>
        <div style={{ color: 'var(--color-subtle)', marginTop: 4 }}>{tt('Installierte Plugins mit verfügbarem Update erscheinen hier.')}</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>{items.length} {tt('Update(s) verfügbar')}</div>
        <button className="btn btn--primary btn--sm" style={{ marginLeft: 'auto' }} onClick={updateAll} disabled={busy !== null}>
          <ArrowUpCircle size={14} /> {tt('Alle aktualisieren')}
        </button>
      </div>
      {items.map((it) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
          <Package size={16} style={{ color: 'var(--color-accent)' }} />
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600 }}>{it.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>→ v{it.version}</div>
          </div>
          <button className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }} onClick={() => update(it.id, it.source)} disabled={busy === it.id}>
            {busy === it.id ? tt('…') : tt('Aktualisieren')}
          </button>
        </div>
      ))}
    </div>
  );
}
