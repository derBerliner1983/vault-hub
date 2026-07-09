import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldCheck, Bug, Download, RefreshCw, Play, Search, CheckCircle2, AlertOctagon } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import type { AntivirusStatus } from '../lib/types';

export function Antivirus() {
  const t = useT();
  const [av, setAv] = useState<AntivirusStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [scanPath, setScanPath] = useState('/home');
  const [scanExclude, setScanExclude] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setAv(await api.antivirus.status()); } catch { /* */ }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    void load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Poll while a scan is running
  useEffect(() => {
    if (av?.scan.running && !pollRef.current) {
      pollRef.current = setInterval(load, 2500);
    } else if (!av?.scan.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [av?.scan.running, load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(''); }
  };

  const startScan = async () => {
    if (!scanPath.startsWith('/')) { alert(tt('Absoluter Pfad erforderlich')); return; }
    await act('scan', () => api.antivirus.scan(scanPath, scanExclude.trim() || undefined));
  };

  const s = av?.scan;
  const lastClean = s && !s.running && s.finishedAt && s.infectedCount === 0;

  return (
    <>
      <Topbar
        title={t('nav.antivirus')}
        subtitle={av?.installed ? av.version || 'ClamAV' : undefined}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        {!av ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>
        ) : !av.installed ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Bug size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Kein Virenschutz installiert')}</div>
            <div className="empty-state__desc">
              ClamAV ist ein quelloffener Virenscanner für Linux. Mit einem Klick installieren:
            </div>
            <button className="btn btn--primary btn--sm" style={{ marginTop: 16 }} disabled={busy === 'install'} onClick={() => act('install', api.antivirus.install)}>
              {busy === 'install' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} ClamAV installieren
            </button>
            <div className="empty-state__desc" style={{ marginTop: 16 }}>
              oder manuell: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '3px 7px', borderRadius: 5 }}>sudo apt install clamav clamav-daemon</code>
            </div>
          </div>
        ) : (
          <SortablePanels storageKey="antivirus" items={[
            { id: 'status', node: (
            <Panel title={tt('Status')} icon={<ShieldCheck size={15} />} subtitle={av.version} storageKey="av-status"
              actions={
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn--outline btn--sm" disabled={busy === 'update'} onClick={() => act('update', api.antivirus.update)}>
                    {busy === 'update' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} Signaturen aktualisieren
                  </button>
                </div>
              }
            >
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={av.daemonActive} disabled={busy === 'daemon'} onChange={(v) => act('daemon', () => api.antivirus.daemon('daemon', v))} />
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{tt('Scan-Daemon')}</span>
                  <span className={`badge badge--${av.daemonActive ? 'running' : 'stopped'}`}><span className="badge__dot" />{av.daemonActive ? 'aktiv' : 'inaktiv'}</span>
                  {busy === 'daemon' && <span className="spinner" style={{ width: 12, height: 12 }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={av.freshclamActive} disabled={busy === 'freshclam'} onChange={(v) => act('freshclam', () => api.antivirus.daemon('freshclam', v))} />
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{tt('Auto-Updates')}</span>
                  <span className={`badge badge--${av.freshclamActive ? 'running' : 'stopped'}`}><span className="badge__dot" />{av.freshclamActive ? 'aktiv' : 'inaktiv'}</span>
                  {busy === 'freshclam' && <span className="spinner" style={{ width: 12, height: 12 }} />}
                </div>
                <span className={`badge badge--${av.defsAgeDays !== null && av.defsAgeDays <= 7 ? 'running' : 'restarting'}`} style={{ height: 24, padding: '0 10px' }}>
                  Signaturen: {av.defsAgeDays === null ? 'unbekannt' : av.defsAgeDays === 0 ? 'heute' : `${av.defsAgeDays} Tage alt`}
                </span>
              </div>
              {!av.daemonActive && av.defsAgeDays === null && (
                <div className="form-hint" style={{ marginTop: 10, color: 'var(--color-warning)' }}>
                  Hinweis: Der Daemon startet erst, wenn Viren-Signaturen vorhanden sind. Klicke zuerst auf „Signaturen aktualisieren".
                </div>
              )}
            </Panel>
            ) },
            { id: 'scan', node: (
            <Panel title={tt('Scan')} icon={<Search size={15} />} subtitle={s?.running ? 'läuft…' : undefined} storageKey="av-scan">
              <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <input className="input input--rect" value={scanPath} onChange={(e) => setScanPath(e.target.value)} placeholder={tt('/home')} style={{ flex: 1, minWidth: 220, fontFamily: 'var(--font-mono)' }} disabled={s?.running} />
                <button className="btn btn--primary btn--sm" disabled={s?.running || busy === 'scan'} onClick={startScan}>
                  {s?.running || busy === 'scan' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={13} />} Scan starten
                </button>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
                {['/home', '/opt', '/var/www', '/tmp', '/'].map((p) => (
                  <button key={p} className="btn btn--outline btn--xs" disabled={s?.running} onClick={() => setScanPath(p)}>{p}</button>
                ))}
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Ordner ausschließen (optional, mehrere mit Komma)</label>
                <input
                  className="input input--rect"
                  value={scanExclude}
                  onChange={(e) => setScanExclude(e.target.value)}
                  placeholder={tt('/home/dirk/Downloads, /var/lib/docker')}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  disabled={s?.running}
                />
                <div className="form-hint">Ausgeschlossene Ordner werden beim Scan übersprungen (nutzt clamscan statt Daemon).</div>
              </div>

              {s?.running && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-accent)', fontSize: 13 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Scanne {s.path} … {s.scanned > 0 && `${s.scanned} Dateien geprüft`}{s.infectedCount > 0 && ` · ${s.infectedCount} Funde`}
                </div>
              )}

              {lastClean && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-success)', fontSize: 14, fontWeight: 600 }}>
                  <CheckCircle2 size={18} /> Keine Bedrohungen gefunden in {s.path} ({s.scanned} Dateien)
                </div>
              )}

              {s && !s.running && s.infectedCount > 0 && (
                <div className="card" style={{ borderColor: 'var(--color-error)' }}>
                  <div className="card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error)', fontWeight: 700, marginBottom: 8 }}>
                      <AlertOctagon size={18} /> {s.infectedCount} Bedrohung(en) gefunden!
                    </div>
                    <table className="dtable">
                      <thead><tr><th>{tt('Datei')}</th><th>{tt('Bedrohung')}</th></tr></thead>
                      <tbody>
                        {s.infected.map((i, idx) => (
                          <tr key={idx}>
                            <td className="dtable__mono" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.file}</td>
                            <td style={{ color: 'var(--color-error)', fontWeight: 600 }}>{i.virus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {s?.error && <div className="login-error" style={{ marginTop: 10 }}>{s.error}</div>}
            </Panel>
            ) },
          ]} />
        )}
      </main>
    </>
  );
}
