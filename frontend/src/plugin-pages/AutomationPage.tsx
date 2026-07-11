import { useState, useEffect, useCallback } from 'react';
import { Clock, Power, Plus, Trash2, Play, Square } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Modal } from '../components/ui/Modal';
import type { CronJob, AutostartUnit } from '../lib/types';

// Native Automatisierungs-Seite (aus Core-Hub portiert). Spricht das Plugin-Backend
// unter /app/automation/api statt der Core-Hub-API.
const API = '/app/automation/api';
async function get(p: string) { const r = await fetch(API + p, { credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function post(p: string, body: unknown) { const r = await fetch(API + p, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function del(p: string) { const r = await fetch(API + p, { method: 'DELETE', credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }

const PRESETS = [
  { label: 'Jede Minute', value: '* * * * *' },
  { label: 'Stündlich', value: '0 * * * *' },
  { label: 'Täglich 03:00', value: '0 3 * * *' },
  { label: 'Wöchentlich (So 04:00)', value: '0 4 * * 0' },
  { label: 'Monatlich (1. 05:00)', value: '0 5 1 * *' },
  { label: 'Bei Neustart', value: '@reboot' },
];

function CronModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [command, setCommand] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!command.trim()) { setError('Befehl erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await post('/jobs', { schedule, command, comment: comment || undefined });
      setCommand(''); setComment(''); onSaved(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={tt('Neuer Cronjob')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} {tt('Hinzufügen')}
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{tt('Zeitplan (m h dom mon dow)')}</label>
        <input className="input input--rect" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
          {PRESETS.map((p) => (
            <button key={p.value} className="btn btn--outline btn--xs" onClick={() => setSchedule(p.value)} type="button">
              {tt(p.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Befehl')}</label>
        <input className="input input--rect" placeholder={tt('/usr/bin/backup.sh')} value={command} onChange={(e) => setCommand(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Beschreibung (optional)')}</label>
        <input className="input input--rect" placeholder={tt('Tägliches Backup')} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </Modal>
  );
}

export function AutomationPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [units, setUnits] = useState<AutostartUnit[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [unitFilter, setUnitFilter] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [c, a] = await Promise.allSettled([get('/jobs'), get('/units')]);
      if (c.status === 'fulfilled') setJobs(c.value.jobs || []);
      if (a.status === 'fulfilled') setUnits(a.value.units || []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const removeJob = async (id: number) => {
    if (!confirm(tt('Cronjob wirklich löschen?'))) return;
    setBusy((b) => ({ ...b, [`c${id}`]: true }));
    try { await del('/jobs/' + id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[`c${id}`]; return n; }); }
  };

  const toggleUnit = async (name: string, enabled: boolean) => {
    setBusy((b) => ({ ...b, [`u${name}`]: true }));
    try {
      await post('/units/control', { service: name, action: enabled ? 'disable' : 'enable' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`u${name}`]; return n; });
    }
  };

  const filteredUnits = units.filter((u) => !unitFilter || u.name.toLowerCase().includes(unitFilter.toLowerCase()));

  return (
    <>
      <Topbar title={tt('Automatisierung')} subtitle={tt('Cronjobs und Autostart-Dienste verwalten')} onRefresh={load} refreshing={refreshing} />
      <main className="page">
        <SortablePanels storageKey="automation" items={[
          { id: 'cron', node: (
        <Panel
          title={tt('Cronjobs')}
          icon={<Clock size={15} />}
          subtitle={`${jobs.length} ${tt('geplante Aufgaben')}`}
          storageKey="cron"
          actions={
            <button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}>
              <Plus size={13} /> {tt('Neu')}
            </button>
          }
        >
          {jobs.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 20px' }}>
              <div className="empty-state__desc">{tt('Keine Cronjobs vorhanden.')}</div>
            </div>
          ) : (
            <table className="dtable" style={{ marginTop: 6 }}>
              <thead>
                <tr><th>{tt('Zeitplan')}</th><th>{tt('Befehl')}</th><th>{tt('Beschreibung')}</th><th style={{ width: 44 }}></th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{j.schedule}</td>
                    <td className="dtable__mono">{j.command}</td>
                    <td className="text-muted">{j.comment || '—'}</td>
                    <td>
                      <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[`c${j.id}`]} onClick={() => removeJob(j.id)}>
                        {busy[`c${j.id}`] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
          ) },
          { id: 'autostart', node: (
        <Panel
          title={tt('Autostart')}
          icon={<Power size={15} />}
          subtitle={tt('Dienste beim Systemstart aktivieren/deaktivieren')}
          storageKey="autostart"
          defaultCollapsed
          actions={
            <input
              className="input input--rect"
              placeholder={tt('Dienst suchen…')}
              value={unitFilter}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setUnitFilter(e.target.value)}
              style={{ height: 28, width: 160, fontSize: 12 }}
            />
          }
        >
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="dtable">
              <thead>
                <tr><th>{tt('Dienst')}</th><th>{tt('Autostart')}</th><th style={{ width: 130 }}></th></tr>
              </thead>
              <tbody>
                {filteredUnits.map((u) => {
                  const enabled = u.state === 'enabled';
                  return (
                    <tr key={u.name}>
                      <td style={{ fontWeight: 600 }}>{u.name.replace('.service', '')}</td>
                      <td>
                        <span className={`badge badge--${enabled ? 'running' : 'stopped'}`}>
                          <span className="badge__dot" />
                          {enabled ? tt('aktiviert') : tt('deaktiviert')}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`btn btn--sm ${enabled ? 'btn--danger' : 'btn--outline'}`}
                          disabled={busy[`u${u.name}`]}
                          onClick={() => toggleUnit(u.name, enabled)}
                        >
                          {busy[`u${u.name}`] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : enabled ? <Square size={12} /> : <Play size={12} />}
                          {enabled ? tt('Deaktivieren') : tt('Aktivieren')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
          ) },
        ]} />
      </main>

      <CronModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={load} />
    </>
  );
}
