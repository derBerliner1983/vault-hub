import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, Cog, Square, Skull, Play, RotateCcw, Search, ChevronUp, ChevronDown, Power } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { formatBytes } from '../lib/utils';
import type { ProcessInfo, SystemService } from '../lib/types';

const API = '/app/taskmanager/api';
async function get(path: string) { const r = await fetch(API + path, { credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function post(path: string, body: unknown) { const r = await fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }

function loadColor(pct: number): string { return pct >= 50 ? 'var(--color-error)' : pct >= 20 ? 'var(--color-warning)' : 'var(--color-muted)'; }
type ProcSortKey = 'name' | 'pid' | 'user' | 'cpu' | 'memRss';

function SortTh({ label, k, num, sortKey, sortDir, onSort }: { label: string; k: ProcSortKey; num?: boolean; sortKey: ProcSortKey; sortDir: 'asc' | 'desc'; onSort: (k: ProcSortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className={`dtable__sortable${num ? ' dtable__num' : ''}`} onClick={() => onSort(k)} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}<span className="dtable__sort-ind" style={{ opacity: active ? 1 : 0.25 }}>{active && sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
    </th>
  );
}

export function TaskManagerPage() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [services, setServices] = useState<SystemService[]>([]);
  const [filter, setFilter] = useState('');
  const [svcFilter, setSvcFilter] = useState('');
  const [svcTab, setSvcTab] = useState<'all' | 'running' | 'autostart'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<ProcSortKey>('cpu');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: ProcSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'user' ? 'asc' : 'desc'); }
  };

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [p, s] = await Promise.allSettled([get('/processes'), get('/services')]);
      if (p.status === 'fulfilled') setProcesses(p.value.processes || []);
      if (s.status === 'fulfilled') setServices(s.value.services || []);
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, [load]);

  const killProc = async (pid: number, name: string, force: boolean) => {
    if (!confirm(`Prozess "${name}" (PID ${pid}) ${force ? 'hart beenden (KILL)' : 'beenden (TERM)'}?`)) return;
    setBusy((b) => ({ ...b, [`p${pid}`]: 'kill' }));
    try { await post(`/processes/${pid}/kill`, { signal: force ? 'KILL' : 'TERM' }); setTimeout(() => void load(), 600); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[`p${pid}`]; return n; }); }
  };
  const controlSvc = async (name: string, action: string) => {
    setBusy((b) => ({ ...b, [`s${name}`]: action }));
    try { await post('/services/control', { service: name, action }); setTimeout(() => void load(), 700); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[`s${name}`]; return n; }); }
  };

  const filteredProcs = useMemo(() => {
    const list = processes.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.command.toLowerCase().includes(filter.toLowerCase()));
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) { case 'name': cmp = a.name.localeCompare(b.name); break; case 'pid': cmp = a.pid - b.pid; break; case 'user': cmp = a.user.localeCompare(b.user); break; case 'cpu': cmp = a.cpu - b.cpu; break; case 'memRss': cmp = a.memRss - b.memRss; break; }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [processes, filter, sortKey, sortDir]);

  const filteredSvcs = useMemo(() => services.filter((s) => {
    if (svcFilter && !s.name.toLowerCase().includes(svcFilter.toLowerCase())) return false;
    if (svcTab === 'running') return s.active === 'active';
    if (svcTab === 'autostart') return s.enabled === true;
    return true;
  }), [services, svcFilter, svcTab]);

  return (
    <>
      <Topbar title={tt('Taskmanager')} subtitle={`${processes.length} ${tt('Prozesse')}`} onRefresh={load} refreshing={refreshing} />
      <main className="page">
        <SortablePanels storageKey="taskmanager" items={[
          { id: 'processes', node: (
            <Panel title={tt('Prozesse')} icon={<Activity size={15} />} subtitle={`${filteredProcs.length} ${tt('angezeigt')}`} storageKey="tm-procs"
              actions={<div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--color-faint)' }} />
                <input className="input input--rect btn--sm" placeholder={tt('Suchen…')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ height: 28, width: 160, paddingLeft: 28, fontSize: 12 }} />
              </div>}>
              <div className="table-scroll" style={{ marginTop: 6 }}>
                <table className="dtable">
                  <thead><tr>
                    <SortTh label={tt('Prozess')} k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="PID" k="pid" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label={tt('Benutzer')} k="user" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="CPU %" k="cpu" num sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="RAM" k="memRss" num sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th style={{ width: 80 }}></th>
                  </tr></thead>
                  <tbody>
                    {filteredProcs.map((p) => (
                      <tr key={p.pid}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          {p.command && <div className="dtable__mono" style={{ fontSize: 10.5, opacity: 0.7, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.command}</div>}
                        </td>
                        <td className="dtable__mono">{p.pid}</td>
                        <td className="text-muted">{p.user}</td>
                        <td className="dtable__num" style={{ color: loadColor(p.cpu), fontWeight: 600 }}>{p.cpu.toFixed(1)}</td>
                        <td className="dtable__num">{formatBytes(p.memRss)}</td>
                        <td><div className="dtable__actions">
                          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Beenden (TERM)')} disabled={!!busy[`p${p.pid}`]} onClick={() => killProc(p.pid, p.name, false)}>
                            {busy[`p${p.pid}`] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Square size={12} />}
                          </button>
                          <button className="btn btn--danger btn--icon btn--sm" title={tt('Hart beenden (KILL)')} disabled={!!busy[`p${p.pid}`]} onClick={() => killProc(p.pid, p.name, true)}><Skull size={12} /></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) },
          { id: 'services', node: (
            <Panel title={tt('Dienste')} icon={<Cog size={15} />} subtitle={`${filteredSvcs.length} ${tt('von')} ${services.length} ${tt('systemd-Diensten')}`} storageKey="tm-svcs"
              actions={<div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {(['all', 'running', 'autostart'] as const).map((tab) => (
                  <button key={tab} className={`btn btn--sm${svcTab === tab ? '' : ' btn--outline'}`} style={{ fontSize: 11, padding: '2px 9px' }} onClick={() => setSvcTab(tab)}>
                    {tab === 'all' ? tt('Alle') : tab === 'running' ? tt('Laufend') : 'Autostart'}
                  </button>
                ))}
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--color-faint)' }} />
                  <input className="input input--rect btn--sm" placeholder={tt('Suchen…')} value={svcFilter} onChange={(e) => setSvcFilter(e.target.value)} style={{ height: 28, width: 140, paddingLeft: 28, fontSize: 12 }} />
                </div>
              </div>}>
              <div className="table-scroll" style={{ marginTop: 6 }}>
                <table className="dtable">
                  <thead><tr><th>{tt('Dienst')}</th><th>{tt('Status')}</th><th>Autostart</th><th>{tt('Beschreibung')}</th><th style={{ width: 110 }}></th></tr></thead>
                  <tbody>
                    {filteredSvcs.map((s) => {
                      const active = s.active === 'active';
                      const isBusy = !!busy[`s${s.name}`];
                      return (
                        <tr key={s.name}>
                          <td style={{ fontWeight: 600 }}>{s.name.replace('.service', '')}</td>
                          <td><span className={`badge badge--${active ? 'running' : 'stopped'}`}><span className="badge__dot" />{s.sub || s.active}</span></td>
                          <td>
                            <button className="btn btn--ghost btn--icon btn--sm" title={s.enabled ? 'Autostart deaktivieren' : 'Autostart aktivieren'} disabled={isBusy} onClick={() => controlSvc(s.name, s.enabled ? 'disable' : 'enable')} style={{ color: s.enabled ? 'var(--color-success)' : 'var(--color-faint)' }}>
                              {busy[`s${s.name}`] === 'enable' || busy[`s${s.name}`] === 'disable' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Power size={13} />}
                            </button>
                          </td>
                          <td className="text-muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</td>
                          <td><div className="dtable__actions">
                            {active
                              ? <button className="btn btn--ghost btn--icon btn--sm" title={tt('Stoppen')} disabled={isBusy} onClick={() => controlSvc(s.name, 'stop')}>{busy[`s${s.name}`] === 'stop' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Square size={12} />}</button>
                              : <button className="btn btn--ghost btn--icon btn--sm" title={tt('Starten')} disabled={isBusy} onClick={() => controlSvc(s.name, 'start')}>{busy[`s${s.name}`] === 'start' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Play size={12} />}</button>}
                            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Neustart')} disabled={isBusy} onClick={() => controlSvc(s.name, 'restart')}><RotateCcw size={12} /></button>
                          </div></td>
                        </tr>
                      );
                    })}
                    {filteredSvcs.length === 0 && (<tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-faint)', padding: '20px 0' }}>{tt('Keine Dienste gefunden')}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) },
        ]} />
      </main>
    </>
  );
}
