import { useState, useEffect, useCallback } from 'react';
import { HardDrive, Plus, Trash2, Download, FolderArchive, RotateCcw, CalendarClock } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { formatBytes, timeAgo } from '../lib/utils';
import type { Backup, BackupSchedule } from '../lib/types';

// Native Backups-Seite (aus Core-Hub portiert, für native Ubuntu-Server auf
// Verzeichnis-Backups reduziert). Spricht /app/backups/api.
const API = '/app/backups/api';
async function get(p: string) { const r = await fetch(API + p, { credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function post(p: string, body: unknown) { const r = await fetch(API + p, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function del(p: string) { const r = await fetch(API + p, { method: 'DELETE', credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Täglich 03:00', value: '0 3 * * *' },
  { label: 'Täglich 12:00', value: '0 12 * * *' },
  { label: 'Wöchentlich (So 03:00)', value: '0 3 * * 0' },
  { label: 'Stündlich', value: '0 * * * *' },
  { label: 'Monatlich (1. um 03:00)', value: '0 3 1 * *' },
];

function NewBackupModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    try {
      if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
      await post('/create', { source: dir, label: label || undefined });
      setDir(''); setLabel(''); onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={tt('Neues Backup')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={run} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} {tt('Backup starten')}
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{tt('Verzeichnis-Pfad')}</label>
        <input className="input input--rect" placeholder={tt('/opt/appdata')} value={dir} onChange={(e) => setDir(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">{tt('Wird als .tar.gz gesichert.')}</div>
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Beschreibung (optional)')}</label>
        <input className="input input--rect" placeholder={tt('appdata')} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
    </Modal>
  );
}

function NewScheduleModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState('');
  const [label, setLabel] = useState('');
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [retention, setRetention] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setLoading(true); setError('');
    try {
      if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
      await post('/schedules', { source: dir, label: label || dir, schedule, retention });
      setDir(''); setLabel(''); onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Automatischer Backup-Zeitplan')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} {tt('Zeitplan anlegen')}
        </button>
      </>}
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{tt('Verzeichnis-Pfad')}</label>
        <input className="input input--rect" placeholder={tt('/opt/appdata')} value={dir} onChange={(e) => setDir(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Beschreibung (optional)')}</label>
        <input className="input input--rect" placeholder={tt('appdata')} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Zeitplan')}</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {CRON_PRESETS.map((p) => (
            <button key={p.value} className={`btn btn--xs ${schedule === p.value ? 'btn--primary' : 'btn--outline'}`} onClick={() => setSchedule(p.value)}>{tt(p.label)}</button>
          ))}
        </div>
        <input className="input input--rect" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">{tt('Cron-Format: Minute Stunde Tag Monat Wochentag')}</div>
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Aufbewahrung (Anzahl Backups behalten)')}</label>
        <input className="input input--rect" type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(Math.max(1, parseInt(e.target.value) || 1))} style={{ maxWidth: 140 }} />
        <div className="form-hint">{tt('Ältere Backups dieses Ziels werden automatisch gelöscht.')}</div>
      </div>
    </Modal>
  );
}

function SchedulesPanel() {
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try { setSchedules((await get('/schedules')).schedules || []); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const withBusy = async (id: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try { await fn(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  return (
    <Panel title={tt('Automatische Zeitpläne')} icon={<CalendarClock size={15} />} subtitle={`${schedules.length} ${tt('Zeitplan/e')}`} storageKey="backup-schedules"
      actions={<button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}><Plus size={13} /> {tt('Neuer Zeitplan')}</button>}
    >
      {schedules.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-state__desc">{tt('Noch keine Zeitpläne. Lege automatische Backups mit Aufbewahrung an.')}</div>
        </div>
      ) : (
        <div className="table-scroll" style={{ marginTop: 6 }}>
          <table className="dtable">
            <thead>
              <tr><th>{tt('Aktiv')}</th><th>{tt('Ziel')}</th><th>{tt('Zeitplan')}</th><th className="dtable__num">{tt('Behalten')}</th><th>{tt('Letzter Lauf')}</th><th style={{ width: 48 }}></th></tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td><Switch checked={!!s.enabled} disabled={busy[s.id]} onChange={(v) => withBusy(s.id, () => post(`/schedules/${s.id}/toggle`, { enabled: v }))} /></td>
                  <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label || s.source}</td>
                  <td className="dtable__mono">{s.schedule}</td>
                  <td className="dtable__num">{s.retention}</td>
                  <td className="text-muted">
                    {s.last_run ? (
                      <span className={s.last_status && s.last_status.startsWith('error') ? 'text-error' : undefined} title={s.last_status ?? ''}>
                        {timeAgo(new Date(s.last_run).getTime() / 1000)} · {s.last_status && s.last_status.startsWith('error') ? tt('Fehler') : 'ok'}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[s.id]} onClick={() => { if (confirm(tt('Zeitplan löschen?'))) void withBusy(s.id, () => del(`/schedules/${s.id}`)); }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewScheduleModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
    </Panel>
  );
}

export function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await get('/list');
      setBackups(res.backups || []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const withBusy = async (id: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try { await fn(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  const remove = (id: string) => { if (confirm(tt('Backup wirklich löschen?'))) void withBusy(id, () => del('/' + id)); };
  const restore = (b: Backup) => { if (confirm(`${tt('Backup nach')} ${b.source} ${tt('wiederherstellen?')}`)) void withBusy(b.id, () => post(`/restore/${b.id}`, {})); };

  const totalSize = backups.reduce((s, b) => s + b.size, 0);

  return (
    <>
      <Topbar
        title={tt('Backups')}
        subtitle={`${backups.length} ${tt('Backups')} · ${formatBytes(totalSize)}`}
        onRefresh={load}
        refreshing={refreshing}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}>
            <Plus size={13} /> {tt('Neues Backup')}
          </button>
        }
      />
      <main className="page">
        <SortablePanels storageKey="backups" items={[
          { id: 'schedules', node: <SchedulesPanel /> },
          { id: 'list', node: (
        <Panel title={tt('Backups')} icon={<HardDrive size={15} />} subtitle={formatBytes(totalSize)} storageKey="backups-list">
          {backups.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state__desc">{tt('Noch keine Backups. Erstelle eins mit „Neues Backup".')}</div>
            </div>
          ) : (
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="dtable">
                <thead>
                  <tr><th>{tt('Typ')}</th><th>{tt('Name')}</th><th>{tt('Quelle')}</th><th className="dtable__num">{tt('Größe')}</th><th>{tt('Erstellt')}</th><th style={{ width: 110 }}></th></tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td><span className="badge badge--paused"><FolderArchive size={11} /> {tt('Verzeichnis')}</span></td>
                      <td style={{ fontWeight: 600 }}>{b.name}</td>
                      <td className="dtable__mono text-muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.source ?? '—'}</td>
                      <td className="dtable__num">{formatBytes(b.size)}</td>
                      <td className="text-muted">{timeAgo(new Date(b.created_at).getTime() / 1000)}</td>
                      <td>
                        <div className="dtable__actions">
                          <a className="btn btn--ghost btn--icon btn--sm" title={tt('Herunterladen')} href={`${API}/download/${b.id}`} download>
                            <Download size={12} />
                          </a>
                          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Wiederherstellen')} disabled={busy[b.id]} onClick={() => restore(b)}>
                            {busy[b.id] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <RotateCcw size={12} />}
                          </button>
                          <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[b.id]} onClick={() => remove(b.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
          ) },
        ]} />
      </main>

      <NewBackupModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
    </>
  );
}
