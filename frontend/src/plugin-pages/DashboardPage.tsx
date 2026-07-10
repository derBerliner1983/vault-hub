import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, MemoryStick, Network, ArrowDown, ArrowUp, ChevronDown, ChevronRight, MonitorCheck } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Donut, donutColor } from '../components/ui/Donut';
import { Sparkline } from '../components/ui/Sparkline';
import { tt } from '../lib/i18n';
import { formatBytes, formatUptime } from '../lib/utils';
import type { SystemStats } from '../lib/types';

const MEM_COLORS = { system: '#71717A', vm: '#F59E0B', docker: '#10B981', free: 'var(--color-border-strong)' };
function loadClass(pct: number): string { return pct >= 90 ? 'loadbar-fill--danger' : pct >= 70 ? 'loadbar-fill--warn' : 'loadbar-fill--accent'; }
function fmtRate(b: number): string { return b < 1024 ? `${Math.round(b)} B/s` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB/s` : `${(b / 1048576).toFixed(1)} MB/s`; }

// Native Dashboard-Seite (aus Core-Hub portiert), angebunden an das
// Dashboard-Plugin-Backend (/app/dashboard/api/stats).
export function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [coresOpen, setCoresOpen] = useState(() => localStorage.getItem('cpu-cores-open') === '1');
  const histRef = useRef<number[]>([]);

  const toggleCores = () => setCoresOpen((v) => { localStorage.setItem('cpu-cores-open', v ? '0' : '1'); return !v; });

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch('/app/dashboard/api/stats', { credentials: 'include' });
      if (r.ok) {
        const s = await r.json() as SystemStats;
        setStats(s);
        histRef.current = [...histRef.current, s.cpu.usage].slice(-40);
        setHistory([...histRef.current]);
      }
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); const id = setInterval(() => void load(), 2000); return () => clearInterval(id); }, [load]);

  const mem = stats?.memory;

  return (
    <>
      <Topbar
        title={tt('Dashboard')}
        subtitle={stats ? `${stats.os.hostname} · ${stats.os.distro} · Uptime ${formatUptime(stats.os.uptime)}` : undefined}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        <SortablePanels storageKey="dashboard" items={[
          { id: 'cpu', node: (
            <Panel
              title={tt('Prozessor')} icon={<Cpu size={15} />} subtitle={stats?.cpu.brand} storageKey="cpu"
              actions={stats && (
                <span style={{ fontSize: 13, fontWeight: 700, color: donutColor(stats.cpu.usage) }}>{stats.cpu.usage}%</span>
              )}
            >
              {stats && (
                <>
                  <div className="donut-group" style={{ marginTop: 12, alignItems: 'center' }}>
                    <div className="donut-item">
                      <Donut size={140} thickness={15}
                        segments={[{ value: stats.cpu.usage, color: donutColor(stats.cpu.usage) }, { value: 100 - stats.cpu.usage, color: 'var(--color-border-strong)' }]}
                        centerLabel={`${stats.cpu.usage}%`} centerSub="Last" centerColor={donutColor(stats.cpu.usage)} />
                      <div className="donut-item__caption">{tt('Gesamtlast')}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 6 }}>{tt('Verlauf (letzte ~3 Min)')}</div>
                      <Sparkline data={history} max={100} height={90} />
                      <div style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 8 }}>{stats.cpu.cores} {tt('Kerne')} · {stats.cpu.speed} GHz</div>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 14, paddingTop: 6 }}>
                    <button className="cpu-cores-toggle" onClick={toggleCores}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', color: 'var(--color-subtle)', fontSize: 12, fontWeight: 600 }}>
                      {coresOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {tt('Einzelne Kerne')} ({stats.cpu.perCore.length})
                    </button>
                    {coresOpen && stats.cpu.perCore.map((load, i) => (
                      <div className="loadbar-row" key={i}>
                        <span className="loadbar-label">CPU {i}</span>
                        <span className="loadbar-pct">{load}%</span>
                        <div className="loadbar-track"><div className={`loadbar-fill ${loadClass(load)}`} style={{ width: `${load}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          ) },
          ...(stats?.gpu && stats.gpu.length > 0 ? [{ id: 'gpu', node: ((() => {
            const g = stats.gpu![0];
            const vramPct = g.vramTotalMb && g.vramUsedMb != null ? Math.round((g.vramUsedMb / g.vramTotalMb) * 100) : null;
            return (
              <Panel title={tt('Grafik')} icon={<MonitorCheck size={15} />} subtitle={g.name} storageKey="gpu"
                actions={g.utilizationPct !== null && (<span style={{ fontSize: 13, fontWeight: 700, color: donutColor(g.utilizationPct) }}>{g.utilizationPct}%</span>)}>
                <div className="donut-group" style={{ marginTop: 12 }}>
                  {g.utilizationPct !== null && (
                    <div className="donut-item">
                      <Donut size={130} thickness={14}
                        segments={[{ value: g.utilizationPct, color: donutColor(g.utilizationPct) }, { value: 100 - g.utilizationPct, color: 'var(--color-border-strong)' }]}
                        centerLabel={`${g.utilizationPct}%`} centerSub="Last" centerColor={donutColor(g.utilizationPct)} />
                      <div className="donut-item__caption"><div style={{ fontWeight: 600 }}>{tt('GPU-Last')}</div></div>
                    </div>
                  )}
                  {g.vramTotalMb !== null && g.vramUsedMb !== null && vramPct !== null && (
                    <div className="donut-item">
                      <Donut size={130} thickness={14}
                        segments={[{ value: g.vramUsedMb, color: donutColor(vramPct) }, { value: g.vramTotalMb - g.vramUsedMb, color: 'var(--color-border-strong)' }]}
                        centerLabel={`${vramPct}%`} centerSub={g.unified ? 'UMA' : 'VRAM'} centerColor={donutColor(vramPct)} />
                      <div className="donut-item__caption">
                        <div style={{ fontWeight: 600 }}>{g.unified ? 'Unified Memory' : 'VRAM'}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-subtle)' }}>{formatBytes(g.vramUsedMb * 1048576)} / {formatBytes(g.vramTotalMb * 1048576)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })()) }] : []),
          { id: 'system', node: (
            <Panel title={tt('System')} icon={<MemoryStick size={15} />} subtitle={mem ? `${tt('Arbeitsspeicher')}: ${formatBytes(mem.total)}` : undefined} storageKey="system">
              {stats && mem && (
                <div className="donut-group" style={{ marginTop: 12 }}>
                  <div className="donut-item">
                    <Donut size={140} thickness={15}
                      segments={[{ value: mem.breakdown.system, color: MEM_COLORS.system }, { value: mem.breakdown.vm, color: MEM_COLORS.vm }, { value: mem.breakdown.docker, color: MEM_COLORS.docker }, { value: mem.breakdown.free, color: MEM_COLORS.free }]}
                      centerLabel={`${mem.percent}%`} centerSub="RAM" centerColor={donutColor(mem.percent)} />
                    <div className="donut-item__caption">{tt('RAM-Nutzung')}</div>
                  </div>
                  <div className="legend" style={{ alignSelf: 'center', minWidth: 170 }}>
                    <div className="legend__item"><span className="legend__dot" style={{ background: MEM_COLORS.system }} /><span className="legend__label">{tt('System')}</span><span className="legend__value">{formatBytes(mem.breakdown.system)}</span></div>
                    <div className="legend__item"><span className="legend__dot" style={{ background: '#A1A1AA' }} /><span className="legend__label">{tt('Frei')}</span><span className="legend__value">{formatBytes(mem.breakdown.free)}</span></div>
                  </div>
                  {stats.disk.slice(0, 4).map((d) => (
                    <div className="donut-item" key={d.mount}>
                      <Donut size={130} thickness={14}
                        segments={[{ value: d.used, color: donutColor(d.percent) }, { value: d.available, color: 'var(--color-border-strong)' }]}
                        centerLabel={`${d.percent}%`} centerColor={donutColor(d.percent)} />
                      <div className="donut-item__caption">
                        <div style={{ fontWeight: 600 }}>{d.mount}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-subtle)' }}>{formatBytes(d.used)} / {formatBytes(d.size)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          ) },
          { id: 'network', node: (
            <Panel title={tt('Netzwerk')} icon={<Network size={15} />} storageKey="network">
              {stats && (
                <table className="dtable" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>{tt('Schnittstelle')}</th><th>{tt('Status')}</th>
                      <th className="dtable__num"><ArrowDown size={11} style={{ display: 'inline' }} /> {tt('Eingehend')}</th>
                      <th className="dtable__num"><ArrowUp size={11} style={{ display: 'inline' }} /> {tt('Ausgehend')}</th>
                      <th className="dtable__num">{tt('Gesamt ↓')}</th><th className="dtable__num">{tt('Gesamt ↑')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.network.map((n) => (
                      <tr key={n.iface}>
                        <td style={{ fontWeight: 600 }}>{n.iface}</td>
                        <td><span className={`badge badge--${n.operstate === 'up' ? 'running' : 'stopped'}`}><span className="badge__dot" />{n.operstate === 'up' ? tt('aktiv') : tt('inaktiv')}</span></td>
                        <td className="dtable__num">{fmtRate(n.rx_sec)}</td>
                        <td className="dtable__num">{fmtRate(n.tx_sec)}</td>
                        <td className="dtable__num dtable__mono">{formatBytes(n.rx_bytes)}</td>
                        <td className="dtable__num dtable__mono">{formatBytes(n.tx_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ) },
        ]} />
      </main>
    </>
  );
}
