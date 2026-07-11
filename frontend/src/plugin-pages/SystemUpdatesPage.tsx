import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import type { PackageUpdate } from '../lib/types';

const API = '/app/system-updates/api';
async function get(p: string) { const r = await fetch(API + p, { credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function post(p: string, body?: unknown) { const r = await fetch(API + p, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }

export function SystemUpdatesPage() {
  const [updates, setUpdates] = useState<PackageUpdate[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [reboot, setReboot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState('');
  const [outputOpen, setOutputOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get('/list');
      setUpdates(res.updates || []); setManager(res.manager); setAvailable(res.available);
      setMessage(res.message ?? ''); setReboot(!!res.rebootRequired);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    setChecking(true);
    try { await post('/check'); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); } finally { setChecking(false); }
  };

  const apply = async (packages?: string[]) => {
    const label = packages ? `${packages.length} Paket(e)` : 'ALLE Updates';
    if (!confirm(`${label} jetzt installieren?`)) return;
    setApplying(true);
    try {
      const res = await post('/apply', { packages: packages || [] });
      setOutput(res.output || 'Fertig.'); setOutputOpen(true);
      setTimeout(() => setOutputOpen(false), 4000);
      if (packages) setUpdates((prev) => prev.filter((u) => !packages.includes(u.name))); else setUpdates([]);
      setTimeout(() => { void load(); }, 3000);
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); } finally { setApplying(false); }
  };

  return (
    <>
      <Topbar title={tt('System-Updates')} subtitle={manager ? `${tt('Paketmanager')}: ${manager}` : undefined} onRefresh={load} refreshing={loading}
        actions={available && (
          <>
            <button className="btn btn--outline btn--sm" onClick={check} disabled={checking}>
              {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} {tt('Nach Updates suchen')}
            </button>
            {updates.length > 0 && (
              <button className="btn btn--primary btn--sm" onClick={() => apply()} disabled={applying}>
                {applying ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} {tt('Alle installieren')} ({updates.length})
              </button>
            )}
          </>
        )} />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Package size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Kein Paketmanager erkannt')}</div>
            <div className="empty-state__desc">{message}</div>
          </div>
        ) : (
          <>
            {reboot && (
              <div className="card" style={{ marginBottom: 14, borderColor: 'var(--color-warning)' }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-warning)' }}>
                  <AlertTriangle size={18} /><span style={{ fontWeight: 600 }}>{tt('Neustart erforderlich')}</span>
                  <span className="text-muted">{tt('Ein Systemneustart ist nötig, um alle Updates zu aktivieren.')}</span>
                </div>
              </div>
            )}
            <Panel title={tt('Verfügbare Updates')} icon={<Package size={15} />} subtitle={`${updates.length} Paket(e)`} storageKey="updates">
              {updates.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state__icon"><CheckCircle2 size={40} strokeWidth={1.2} color="var(--color-success)" /></div>
                  <div className="empty-state__title">{tt('System ist aktuell')}</div>
                  <div className="empty-state__desc">{tt('Keine Updates verfügbar. Klicke „Nach Updates suchen", um den Index zu aktualisieren.')}</div>
                </div>
              ) : (
                <div className="table-scroll" style={{ marginTop: 6 }}>
                  <table className="dtable">
                    <thead><tr><th>{tt('Paket')}</th><th>{tt('Aktuell')}</th><th>{tt('Neu')}</th><th>{tt('Quelle')}</th><th style={{ width: 100 }}></th></tr></thead>
                    <tbody>
                      {updates.map((u) => (
                        <tr key={u.name}>
                          <td style={{ fontWeight: 600 }}>{u.name}</td>
                          <td className="dtable__mono text-muted">{u.currentVersion || '—'}</td>
                          <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{u.newVersion}</td>
                          <td className="text-muted">{u.repo}</td>
                          <td><button className="btn btn--outline btn--sm" disabled={applying} onClick={() => apply([u.name])}><Download size={11} /> Update</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </main>
      <Modal open={outputOpen} title={tt('Update-Ausgabe')} onClose={() => setOutputOpen(false)} width={680}>
        <div className="log-viewer" style={{ maxHeight: 460 }}>{output}</div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-success)', textAlign: 'right' }}>✓ Fertig – Fenster schließt automatisch…</div>
      </Modal>
    </>
  );
}
