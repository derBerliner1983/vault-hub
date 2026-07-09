import { useState, useEffect, useCallback } from 'react';
import { HardDrive, Plus, Trash2, Download, Container, FolderArchive, MonitorPlay, Play, CalendarClock } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { formatBytes, timeAgo } from '../lib/utils';
import type { Backup, BackupSource, BackupSchedule, VM } from '../lib/types';

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Täglich 03:00', value: '0 3 * * *' },
  { label: 'Täglich 12:00', value: '0 12 * * *' },
  { label: 'Wöchentlich (So 03:00)', value: '0 3 * * 0' },
  { label: 'Stündlich', value: '0 * * * *' },
  { label: 'Monatlich (1. um 03:00)', value: '0 3 1 * *' },
];

const TYPE_ICON: Record<string, React.ElementType> = {
  container: Container,
  directory: FolderArchive,
  vm: MonitorPlay,
};

function NewBackupModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'container' | 'directory' | 'vm'>('container');
  const [sources, setSources] = useState<BackupSource[]>([]);
  const [vms, setVms] = useState<VM[]>([]);
  const [containerId, setContainerId] = useState('');
  const [stopFirst, setStopFirst] = useState(true);
  const [dir, setDir] = useState('');
  const [vm, setVm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    api.backups.sources().then((r) => { setSources(r.containers); if (r.containers[0]) setContainerId(r.containers[0].id); }).catch(() => {});
    api.vms.list().then((r) => { setVms(r.vms); if (r.vms[0]) setVm(r.vms[0].name); }).catch(() => {});
  }, [open]);

  const run = async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'container') {
        if (!containerId) throw new Error('Container wählen');
        await api.backups.backupContainer(containerId, stopFirst);
      } else if (tab === 'directory') {
        if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
        await api.backups.backupDirectory(dir);
      } else {
        if (!vm) throw new Error('VM wählen');
        await api.backups.backupVm(vm);
      }
      onDone(); onClose();
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
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Backup starten
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="filter-tabs" style={{ marginBottom: 4 }}>
        <button className={`filter-tab${tab === 'container' ? ' filter-tab--active' : ''}`} onClick={() => setTab('container')}>{tt('Container')}</button>
        <button className={`filter-tab${tab === 'directory' ? ' filter-tab--active' : ''}`} onClick={() => setTab('directory')}>{tt('Verzeichnis')}</button>
        <button className={`filter-tab${tab === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setTab('vm')}>VM</button>
      </div>

      {tab === 'container' && (
        <>
          <div className="form-group">
            <label className="form-label">Container (mit Volumes)</label>
            <select className="input input--rect" value={containerId} onChange={(e) => setContainerId(e.target.value)} style={{ cursor: 'pointer' }}>
              {sources.length === 0 && <option value="">{tt('Keine Container mit Volumes')}</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.volumes} Volume{s.volumes !== 1 ? 's' : ''})</option>)}
            </select>
          </div>
          <label className="legend__item" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={stopFirst} onChange={(e) => setStopFirst(e.target.checked)} />
            <span>Container während des Backups stoppen (konsistenter)</span>
          </label>
        </>
      )}
      {tab === 'directory' && (
        <div className="form-group">
          <label className="form-label">{tt('Verzeichnis-Pfad')}</label>
          <input className="input input--rect" placeholder={tt('/opt/appdata')} value={dir} onChange={(e) => setDir(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">{tt('Wird als .tar.gz gesichert.')}</div>
        </div>
      )}
      {tab === 'vm' && (
        <div className="form-group">
          <label className="form-label">{tt('Virtuelle Maschine')}</label>
          <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
            {vms.length === 0 && <option value="">{tt('Keine VMs')}</option>}
            {vms.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
          <div className="form-hint">qcow2-Disk wird komprimiert gesichert (kann dauern).</div>
        </div>
      )}
    </Modal>
  );
}

function NewScheduleModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'container' | 'directory' | 'vm'>('container');
  const [sources, setSources] = useState<BackupSource[]>([]);
  const [vms, setVms] = useState<VM[]>([]);
  const [containerId, setContainerId] = useState('');
  const [dir, setDir] = useState('');
  const [vm, setVm] = useState('');
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [retention, setRetention] = useState(7);
  const [stopFirst, setStopFirst] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    api.backups.sources().then((r) => { setSources(r.containers); if (r.containers[0]) setContainerId(r.containers[0].id); }).catch(() => {});
    api.vms.list().then((r) => { setVms(r.vms); if (r.vms[0]) setVm(r.vms[0].name); }).catch(() => {});
  }, [open]);

  const save = async () => {
    setLoading(true); setError('');
    try {
      let source = '';
      let label = '';
      if (type === 'container') {
        if (!containerId) throw new Error('Container wählen');
        source = containerId; label = sources.find((s) => s.id === containerId)?.name || 'Container';
      } else if (type === 'directory') {
        if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
        source = dir; label = dir;
      } else {
        if (!vm) throw new Error('VM wählen');
        source = vm; label = vm;
      }
      await api.backups.createSchedule({ type, source, label, schedule, retention, stop: stopFirst });
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Automatischer Backup-Zeitplan')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Zeitplan anlegen
        </button>
      </>}
    >
      {error && <div className="login-error">{error}</div>}
      <div className="filter-tabs" style={{ marginBottom: 4 }}>
        <button className={`filter-tab${type === 'container' ? ' filter-tab--active' : ''}`} onClick={() => setType('container')}>{tt('Container')}</button>
        <button className={`filter-tab${type === 'directory' ? ' filter-tab--active' : ''}`} onClick={() => setType('directory')}>{tt('Verzeichnis')}</button>
        <button className={`filter-tab${type === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setType('vm')}>VM</button>
      </div>

      {type === 'container' && (
        <div className="form-group">
          <label className="form-label">Container (mit Volumes)</label>
          <select className="input input--rect" value={containerId} onChange={(e) => setContainerId(e.target.value)} style={{ cursor: 'pointer' }}>
            {sources.length === 0 && <option value="">{tt('Keine Container mit Volumes')}</option>}
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.volumes} Volume{s.volumes !== 1 ? 's' : ''})</option>)}
          </select>
          <label className="legend__item" style={{ cursor: 'pointer', marginTop: 8 }}>
            <input type="checkbox" checked={stopFirst} onChange={(e) => setStopFirst(e.target.checked)} />
            <span>{tt('Container während des Backups stoppen')}</span>
          </label>
        </div>
      )}
      {type === 'directory' && (
        <div className="form-group">
          <label className="form-label">{tt('Verzeichnis-Pfad')}</label>
          <input className="input input--rect" placeholder={tt('/opt/appdata')} value={dir} onChange={(e) => setDir(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
      )}
      {type === 'vm' && (
        <div className="form-group">
          <label className="form-label">{tt('Virtuelle Maschine')}</label>
          <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
            {vms.length === 0 && <option value="">{tt('Keine VMs')}</option>}
            {vms.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">{tt('Zeitplan')}</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {CRON_PRESETS.map((p) => (
            <button key={p.value} className={`btn btn--xs ${schedule === p.value ? 'btn--primary' : 'btn--outline'}`} onClick={() => setSchedule(p.value)}>{p.label}</button>
          ))}
        </div>
        <input className="input input--rect" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">{tt('Cron-Format: Minute Stunde Tag Monat Wochentag')}</div>
      </div>

      <div className="form-group">
        <label className="form-label">Aufbewahrung (Anzahl Backups behalten)</label>
        <input className="input input--rect" type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(Math.max(1, parseInt(e.target.value) || 1))} style={{ maxWidth: 140 }} />
        <div className="form-hint">{tt('Ältere Backups dieses Ziels werden automatisch gelöscht.')}</div>
      </div>
    </Modal>
  );
}

function SchedulesPanel() {
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try { setSchedules((await api.backups.schedules()).schedules); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const withBusy = async (id: number, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try { await fn(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  return (
    <Panel title={tt('Automatische Zeitpläne')} icon={<CalendarClock size={15} />} subtitle={`${schedules.length} Zeitplan/e`} storageKey="backup-schedules"
      actions={<button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}><Plus size={13} /> {tt('Neuer Zeitplan')}</button>}
    >
      {schedules.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-state__desc">{tt('Noch keine Zeitpläne. Lege automatische Backups mit Aufbewahrung an.')}</div>
        </div>
      ) : (
        <div className="table-scroll" style={{ marginTop: 6 }}>
          <table className="dtable">
            <thead>
              <tr><th>{tt('Aktiv')}</th><th>{tt('Typ')}</th><th>{tt('Ziel')}</th><th>{tt('Zeitplan')}</th><th className="dtable__num">{tt('Behalten')}</th><th>{tt('Letzter Lauf')}</th><th style={{ width: 90 }}></th></tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td><Switch checked={s.enabled === 1} disabled={busy[s.id]} onChange={(v) => withBusy(s.id, () => api.backups.toggleSchedule(s.id, v))} /></td>
                  <td><span className="badge badge--paused">{s.type}</span></td>
                  <td style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</td>
                  <td className="dtable__mono">{s.schedule}</td>
                  <td className="dtable__num">{s.retention}</td>
                  <td className="text-muted">
                    {s.last_run ? (
                      <span className={s.last_status === 'error' ? 'text-error' : undefined} title={s.last_message ?? ''}>
                        {timeAgo(new Date(s.last_run).getTime() / 1000)} · {s.last_status === 'error' ? 'Fehler' : 'ok'}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <div className="dtable__actions">
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('Jetzt ausführen')} disabled={busy[s.id]} onClick={() => withBusy(s.id, () => api.backups.runSchedule(s.id))}>
                        {busy[s.id] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Play size={12} />}
                      </button>
                      <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[s.id]} onClick={() => { if (confirm(tt('Zeitplan löschen?'))) void withBusy(s.id, () => api.backups.removeSchedule(s.id)); }}>
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
      <NewScheduleModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
    </Panel>
  );
}

export function Backups() {
  const t = useT();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [dir, setDir] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.backups.list();
      setBackups(res.backups);
      setDir(res.dir);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm(tt('Backup wirklich löschen?'))) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try { await api.backups.remove(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  const totalSize = backups.reduce((s, b) => s + b.size, 0);

  return (
    <>
      <Topbar
        title={t('nav.backups')}
        subtitle={t('page.backups.subtitle', { n: backups.length, size: formatBytes(totalSize), dir })}
        onRefresh={load}
        refreshing={refreshing}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}>
            <Plus size={13} /> Neues Backup
          </button>
        }
      />
      <main className="page">
        <SortablePanels storageKey="backups" items={[
          { id: 'schedules', node: <SchedulesPanel /> },
          { id: 'list', node: (
        <Panel title={tt('Backups')} icon={<HardDrive size={15} />} subtitle={formatBytes(totalSize)} storageKey="backups">
          {backups.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state__desc">{tt('Noch keine Backups. Erstelle eins mit „Neues Backup".')}</div>
            </div>
          ) : (
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="dtable">
                <thead>
                  <tr><th>{tt('Typ')}</th><th>{tt('Name')}</th><th>{tt('Quelle')}</th><th className="dtable__num">{tt('Größe')}</th><th>{tt('Erstellt')}</th><th style={{ width: 80 }}></th></tr>
                </thead>
                <tbody>
                  {backups.map((b) => {
                    const Icon = TYPE_ICON[b.type] ?? HardDrive;
                    return (
                      <tr key={b.id}>
                        <td><span className="badge badge--paused"><Icon size={11} /> {b.type}</span></td>
                        <td style={{ fontWeight: 600 }}>{b.name}</td>
                        <td className="dtable__mono text-muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.source ?? '—'}</td>
                        <td className="dtable__num">{formatBytes(b.size)}</td>
                        <td className="text-muted">{timeAgo(new Date(b.created_at + 'Z').getTime() / 1000)}</td>
                        <td>
                          <div className="dtable__actions">
                            {b.exists && (
                              <a className="btn btn--ghost btn--icon btn--sm" title={tt('Herunterladen')} href={api.backups.downloadUrl(b.id)} download>
                                <Download size={12} />
                              </a>
                            )}
                            <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[b.id]} onClick={() => remove(b.id)}>
                              {busy[b.id] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
