import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import {
  KeyRound, ShieldCheck, ArrowUpCircle, RefreshCw, CheckCircle2, Package, Puzzle,
  Languages, Smartphone, Copy, RotateCw,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { tt, useI18n, LANGUAGES } from '../lib/i18n';
import { timeAgo } from '../lib/utils';
import { api } from '../lib/api';
import {
  fetchStore, fetchInstalledPlugins, installPlugin, useInstalledPlugins,
  type StoreItem, type PluginManifest,
} from '../lib/plugins';

interface VersionInfo {
  current: string; latest: string | null; updateAvailable: boolean;
  behind: number; method: string; repo: string; releaseUrl: string;
  checkedAt: string; error?: string;
}

export function Settings() {
  return (
    <>
      <Topbar title={tt('Einstellungen')} />
      <div className="page">
        <RestartBanner />
        <SortablePanels storageKey="settings" items={[
          { id: 'password', node: <PasswordPanel /> },
          { id: '2fa', node: <TwoFactorPanel /> },
          { id: 'language', node: <LanguagePanel /> },
          { id: 'extensions', node: <ExtensionsPanel /> },
          { id: 'version', node: <VersionPanel /> },
          { id: 'app-updates', node: <AppUpdatesPanel /> },
        ]} />
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
    <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--color-warning)', display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
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

// ─── Account: Passwort ändern ─────────────────────────────────────────────────

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (next !== confirm) { setMsg({ type: 'err', text: tt('Passwörter stimmen nicht überein.') }); return; }
    if (next.length < 6) { setMsg({ type: 'err', text: tt('Neues Passwort zu kurz (min. 6 Zeichen).') }); return; }
    setLoading(true); setMsg(null);
    try {
      await api.auth.changePassword(current, next);
      setMsg({ type: 'ok', text: tt('Passwort geändert.') });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler beim Ändern.') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title={tt('Passwort ändern')} icon={<KeyRound size={15} />} subtitle={tt('Dein Vault-Hub Login')} storageKey="set-pw">
      <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {msg && <div className="login-error" style={msg.type === 'ok' ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined}>{msg.text}</div>}
        <div className="form-group"><label className="form-label">{tt('Aktuelles Passwort')}</label>
          <input className="input input--rect" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Neues Passwort')}</label>
          <input className="input input--rect" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Neues Passwort bestätigen')}</label>
          <input className="input input--rect" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <button className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={loading || !current || !next}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} {tt('Passwort speichern')}
        </button>
      </div>
    </Panel>
  );
}

/** Base32-Secret in 4er-Gruppen für leichtere manuelle Eingabe am Handy. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(' ');
}

/** Rendert eine otpauth://-URI als scanbaren QR-Code (SVG, weißer Hintergrund). */
function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch {
      return '';
    }
  }, [value]);

  if (!svg) return null;
  return (
    <div
      style={{
        width: size, height: size, padding: 10, background: '#fff',
        borderRadius: 10, boxShadow: '0 0 0 1px var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function TwoFactorPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setEnabled((await api.auth.twoFactor.status()).enabled); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const begin = async () => {
    setBusy(true); setMsg(null);
    try { setSetup(await api.auth.twoFactor.setup()); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.auth.twoFactor.enable(code);
      setSetup(null); setCode(''); setMsg({ type: 'ok', text: tt('2FA aktiviert. Beim nächsten Login wird ein Code abgefragt.') });
      await load();
    } catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!pw) { setMsg({ type: 'err', text: tt('Passwort erforderlich') }); return; }
    setBusy(true); setMsg(null);
    try { await api.auth.twoFactor.disable(pw); setPw(''); setMsg({ type: 'ok', text: tt('2FA deaktiviert.') }); await load(); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={tt('Zwei-Faktor-Authentifizierung (2FA)')} icon={<ShieldCheck size={15} />}
      subtitle={enabled === null ? undefined : enabled ? tt('aktiv') : tt('inaktiv')} storageKey="set-2fa"
      actions={enabled !== null && (
        <span className={`badge badge--${enabled ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
          <span className="badge__dot" /> {enabled ? tt('aktiv') : tt('inaktiv')}
        </span>
      )}
    >
      <div style={{ maxWidth: 460, marginTop: 8 }}>
        {msg && <div className="login-error" style={msg.type === 'ok' ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', marginBottom: 10 } : { marginBottom: 10 }}>{msg.text}</div>}

        {enabled === null ? (
          <span className="spinner" />
        ) : enabled ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
              {tt('Dein Konto ist mit einer Authenticator-App (TOTP) abgesichert. Zum Deaktivieren bitte Passwort eingeben.')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" type="password" placeholder={tt('Aktuelles Passwort')} value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn--danger btn--sm" onClick={disable} disabled={busy}>{tt('2FA deaktivieren')}</button>
            </div>
          </>
        ) : setup ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              <Smartphone size={13} style={{ verticalAlign: -2 }} /> {tt('Scanne den QR-Code mit deiner Authenticator-App (Google Authenticator, Aegis, 1Password …) – oder gib den geheimen Schlüssel manuell ein.')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <QrCode value={setup.otpauth} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">{tt('Kein QR-Scan möglich? Schlüssel manuell eingeben')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, background: 'var(--color-surface-sunken)', padding: '10px 12px', borderRadius: 6, letterSpacing: '0.12em', wordBreak: 'break-all', textAlign: 'center' }}>{groupSecret(setup.secret)}</code>
                <button className="btn btn--outline btn--icon btn--sm" title={tt('Kopieren')} onClick={() => navigator.clipboard?.writeText(setup.secret)}><Copy size={13} /></button>
              </div>
              <div className="form-hint" style={{ marginTop: 4 }}>{tt('In der Authenticator-App „Schlüssel manuell eingeben" wählen und diesen Code eintippen (Leerzeichen ignorieren).')}</div>
            </div>
            <label className="form-label">{tt('Code aus der App zum Bestätigen')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" inputMode="numeric" placeholder="000000" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ flex: 1, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
              <button className="btn btn--primary btn--sm" onClick={activate} disabled={busy || code.length !== 6}>{tt('Aktivieren')}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              {tt('Schütze deinen Login mit einem zusätzlichen Einmalcode aus einer Authenticator-App.')}
            </div>
            <button className="btn btn--primary btn--sm" onClick={begin} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} {tt('2FA einrichten')}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

function LanguagePanel() {
  const { lang, setLang } = useI18n();
  const change = (code: string) => {
    setLang(code);
    // tt-basierte Komponenten sind nicht reaktiv → einmal neu laden für sofortige Wirkung.
    setTimeout(() => window.location.reload(), 50);
  };
  return (
    <Panel title={tt('Sprache')} icon={<Languages size={15} />} subtitle={tt('Basis: Deutsch & Englisch. Weitere Sprachen kommen modular über den Store.')} storageKey="set-lang">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {LANGUAGES.map((l) => (
          <button key={l.code} className={`btn btn--sm ${lang === l.code ? 'btn--primary' : 'btn--outline'}`} onClick={() => change(l.code)}>
            {l.flag ? <span style={{ fontSize: 15 }}>{l.flag}</span> : null} {l.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ─── Erweiterungen: System-Erweiterungen (Typ A) mit Dienst-Schalter/Panel ────

function ExtensionsPanel() {
  const { plugins, loading } = useInstalledPlugins();
  const exts = plugins.filter((p) => p.contributes?.serviceToggle || p.contributes?.settingsPanel);

  return (
    <Panel title={tt('Erweiterungen')} icon={<Puzzle size={15} />} subtitle={tt('System-Erweiterungen aus dem Store')} storageKey="set-extensions">
      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}><span className="spinner" /></div>
      ) : exts.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div className="empty-state__desc">{tt('Installiere z. B. „SSH-Zugang" aus dem Store, dann erscheint hier der Schalter.')}</div>
        </div>
      ) : (
        <div className="stats-grid" style={{ marginTop: 8 }}>{exts.map((p) => <ExtensionCard key={p.id} plugin={p} />)}</div>
      )}
    </Panel>
  );
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
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
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

// ─── Version & Updates: Grundsystem (git-basiert, wie Core-Hub) ───────────────

function VersionPanel() {
  const [ver, setVer] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try {
      const r = await fetch(`/api/settings/version${refresh ? '?refresh=1' : ''}`, { credentials: 'include' });
      setVer(await r.json());
    } catch { /* offline */ }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(false); }, [check]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [updateLog]);

  const pollForNewVersion = async (priorBuild?: string) => {
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          const h = await res.json().catch(() => null) as { version?: string } | null;
          const now = h?.version;
          if (now && priorBuild && now !== priorBuild) {
            setUpdateLog((l) => [...l, `✓ ${tt('Neue Version')} v${now} ${tt('aktiv – lade Seite neu…')}`]);
            setTimeout(() => location.reload(), 1000);
            return;
          }
        }
      } catch { /* Dienst noch nicht erreichbar */ }
    }
  };

  const startUpdate = () => {
    if (!confirm(tt('Vault-Hub jetzt aktualisieren? Der Dienst wird kurz neu gestartet.'))) return;
    setUpdating(true); setUpdateDone(false);
    setUpdateLog(['▶ ' + tt('Update gestartet…')]);
    const priorBuild = ver?.current;
    let finished = false;

    const onDone = () => {
      if (finished) return;
      finished = true;
      setUpdateLog((l) => [...l, '', '✓ ' + tt('Installation abgeschlossen. Vault-Hub wird neu gestartet…')]);
      setUpdating(false); setUpdateDone(true);
      void check(false);
      void pollForNewVersion(priorBuild);
    };

    const es = new EventSource('/api/settings/update/stream', { withCredentials: true });
    es.onmessage = (evt) => {
      try { const d = JSON.parse(evt.data) as { line: string }; setUpdateLog((l) => [...l, d.line]); }
      catch { /* */ }
    };
    es.addEventListener('done', () => { es.close(); onDone(); });
    es.onerror = () => { es.close(); onDone(); };
  };

  return (
    <Panel title={tt('Version & Updates')} icon={<ArrowUpCircle size={15} />} subtitle={ver ? `v${ver.current}` : undefined} storageKey="set-version"
      actions={
        <button className="btn btn--outline btn--sm" disabled={checking} onClick={() => check(true)}>
          {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} {tt('Prüfen')}
        </button>
      }
    >
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>Vault-Hub v{ver?.current ?? '…'}</span>
          {ver && ver.updateAvailable && (
            <span className="badge badge--restarting" style={{ height: 26, padding: '0 12px' }}>
              <ArrowUpCircle size={13} /> {tt('Update verfügbar')}: {ver.latest}
            </span>
          )}
          {ver && !ver.updateAvailable && !ver.error && (
            <span className="badge badge--running" style={{ height: 26, padding: '0 12px' }}>
              <CheckCircle2 size={13} /> {tt('Aktuell')}
            </span>
          )}
        </div>

        {ver?.error && <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 10 }}>{tt('Versionsprüfung')}: {ver.error}</div>}

        {ver?.updateAvailable && !updating && !updateDone && (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--color-warning)', padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tt('Neue Version')} {ver.latest} {tt('verfügbar')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
              {tt('Vault-Hub automatisch aktualisieren: neuen Code holen, Abhängigkeiten installieren und Dienst neu starten. Deine Daten bleiben erhalten.')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn--primary btn--sm" onClick={startUpdate}>
                <ArrowUpCircle size={13} /> {tt('Jetzt aktualisieren')}
              </button>
              {ver.releaseUrl && (
                <a className="btn btn--outline btn--sm" href={ver.releaseUrl} target="_blank" rel="noreferrer">
                  {tt('Release-Notes ansehen')}
                </a>
              )}
            </div>
          </div>
        )}

        {(updating || updateDone) && updateLog.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div ref={logRef} style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {updateLog.join('\n')}
              {updating && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginLeft: 6 }}>⟳</span>}
            </div>
            {updateDone && (
              <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => location.reload()}>
                <RotateCw size={13} /> {tt('Seite neu laden')}
              </button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 12 }}>
          {tt('Repository')}: {ver?.repo ?? '—'}
          {ver ? ` · ${tt('zuletzt geprüft')} ${timeAgo(new Date(ver.checkedAt).getTime() / 1000)}` : ''}
        </div>
      </div>
    </Panel>
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

  return (
    <Panel title={tt('Updatefähige Apps')} icon={<Package size={15} />} subtitle={items.length ? `${items.length} ${tt('Update(s) verfügbar')}` : undefined} storageKey="set-app-updates"
      actions={items.length > 0 && (
        <button className="btn btn--primary btn--sm" onClick={updateAll} disabled={busy !== null}>
          <ArrowUpCircle size={14} /> {tt('Alle aktualisieren')}
        </button>
      )}
    >
      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px', textAlign: 'center' }}>
          <CheckCircle2 size={26} style={{ color: 'var(--color-success)' }} />
          <div className="empty-state__title" style={{ marginTop: 8 }}>{tt('Alle Apps sind aktuell')}</div>
          <div className="empty-state__desc">{tt('Installierte Plugins mit verfügbarem Update erscheinen hier.')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
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
      )}
    </Panel>
  );
}
