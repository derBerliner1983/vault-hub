import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Package, Trash2, Download, Search, X, CheckCircle2, Boxes, AlertTriangle, FileDown, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { formatBytes } from '../lib/utils';
import type { InstalledPackage, PackageSearchResult } from '../lib/types';

const API = '/app/packages/api';
async function get(p: string) { const r = await fetch(API + p, { credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
async function post(p: string, body: unknown) { const r = await fetch(API + p, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }

type SortKey = 'name' | 'version' | 'size' | 'type';

export function PackagesPage() {
  const [packages, setPackages] = useState<InstalledPackage[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyManual, setOnlyManual] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [outputOpen, setOutputOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try { const res = await get('/installed'); setPackages(res.packages || []); setManager(res.manager); setAvailable(res.available); }
    finally { if (showSpinner) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => { if (!busy) void load(false); }, 10000); return () => clearInterval(id); }, [load, busy]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = packages.filter((p) => { if (onlyManual && p.auto) return false; if (!q) return true; return p.name.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q); });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let c = 0;
      if (sortKey === 'size') c = (a.size || 0) - (b.size || 0);
      else if (sortKey === 'version') c = a.version.localeCompare(b.version, undefined, { numeric: true });
      else if (sortKey === 'type') c = (a.auto ? 1 : 0) - (b.auto ? 1 : 0) || a.name.localeCompare(b.name);
      else c = a.name.localeCompare(b.name);
      return c * dir;
    });
    return list;
  }, [packages, filter, onlyManual, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(key); setSortDir('asc'); } };
  const sortIcon = (key: SortKey) => sortKey !== key ? <ChevronsUpDown size={12} style={{ opacity: 0.4 }} /> : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  const totalSize = useMemo(() => packages.reduce((s, p) => s + p.size, 0), [packages]);

  const toggleSel = (name: string) => setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.name));
  const toggleAllVisible = () => setSelected((prev) => { const n = new Set(prev); if (allVisibleSelected) filtered.forEach((p) => n.delete(p.name)); else filtered.forEach((p) => n.add(p.name)); return n; });

  const remove = async (names: string[], purge: boolean) => {
    if (!names.length) return;
    const verb = purge ? 'inkl. Konfiguration vollständig entfernen (purge)' : 'entfernen';
    if (!confirm(`${names.length} Paket(e) ${verb}?\n\n${names.slice(0, 20).join(', ')}${names.length > 20 ? ' …' : ''}`)) return;
    setBusy(true);
    try { const res = await post('/remove', { packages: names, purge }); setOutput(res.output || 'Fertig.'); setOutputOpen(true); setTimeout(() => setOutputOpen(false), 4000); setSelected(new Set()); setTimeout(() => void load(false), 2000); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); } finally { setBusy(false); }
  };

  const exportPackages = (list: InstalledPackage[], scope: string) => {
    if (!list.length) return;
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    const header = [`# Vault-Hub Paket-Export (${scope})`, `# Paketmanager: ${manager ?? 'unbekannt'}`, `# Exportiert: ${new Date().toLocaleString('de-DE')}`, `# Anzahl: ${sorted.length}`, `# Wiederherstellen (apt): grep -v '^#' DATEI | xargs sudo apt-get install -y`, ''].join('\n');
    const blob = new Blob([header + sorted.map((p) => p.name).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `pakete-${scope}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const exportSelected = () => exportPackages(packages.filter((p) => selected.has(p.name)), 'auswahl');

  const runSearch = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try { setResults((await get('/search?q=' + encodeURIComponent(q.trim()))).results || []); } catch { setResults([]); } finally { setSearching(false); }
    }, 400);
  };
  const install = async (name: string) => {
    if (!confirm(`Paket „${name}" installieren?`)) return;
    setBusy(true);
    try { const res = await post('/install', { packages: [name] }); setOutput(res.output || 'Fertig.'); setOutputOpen(true); setTimeout(() => setOutputOpen(false), 4000); setInstallOpen(false); setQuery(''); setResults([]); setTimeout(() => void load(false), 2000); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); } finally { setBusy(false); }
  };

  const selCount = selected.size;

  return (
    <>
      <Topbar title={tt('Paketverwaltung')} subtitle={manager ? `${manager} · ${packages.length} ${tt('Pakete')} · ${formatBytes(totalSize)}` : undefined} onRefresh={() => load()} refreshing={loading}
        actions={available && (
          <>
            <button className="btn btn--outline btn--sm" onClick={() => exportPackages(packages, 'alle')} disabled={!packages.length}><FileDown size={13} /> {tt('Alle exportieren')}</button>
            <button className="btn btn--primary btn--sm" onClick={() => setInstallOpen(true)} disabled={busy}><Download size={13} /> {tt('Paket installieren')}</button>
          </>
        )} />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Package size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Kein Paketmanager erkannt')}</div>
            <div className="empty-state__desc">{tt('Dieses System stellt keinen unterstützten Paketmanager bereit.')}</div>
          </div>
        ) : (
          <Panel title={tt('Installierte Pakete')} icon={<Boxes size={15} />} subtitle={`${filtered.length} von ${packages.length}`} storageKey="packages">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 12px' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
                <input className="input input--rect" placeholder={tt('Pakete filtern…')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', paddingLeft: 30 }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={onlyManual} onChange={(e) => setOnlyManual(e.target.checked)} /> {tt('Nur manuell installierte')}
              </label>
            </div>
            {selCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 10, background: 'var(--color-accent-soft)', borderRadius: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{selCount} {tt('ausgewählt')}</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn--outline btn--sm" onClick={exportSelected}><FileDown size={12} /> {tt('Exportieren')}</button>
                <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => remove([...selected], false)}><Trash2 size={12} /> {tt('Entfernen')}</button>
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => remove([...selected], true)}>{tt('Vollständig (purge)')}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}><X size={12} /> {tt('Auswahl aufheben')}</button>
              </div>
            )}
            <div className="table-scroll" style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('name')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{tt('Paket')} {sortIcon('name')}</span></th>
                    <th style={{ width: 130, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('version')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{tt('Version')} {sortIcon('version')}</span></th>
                    <th style={{ width: 90, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('size')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{tt('Größe')} {sortIcon('size')}</span></th>
                    <th style={{ width: 90, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('type')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{tt('Typ')} {sortIcon('type')}</span></th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--color-muted)' }}>{tt('Keine Pakete gefunden.')}</td></tr>
                  ) : filtered.slice(0, 600).map((p) => (
                    <tr key={p.name} style={selected.has(p.name) ? { background: 'var(--color-accent-soft)' } : undefined}>
                      <td><input type="checkbox" checked={selected.has(p.name)} onChange={() => toggleSel(p.name)} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.summary && <div className="text-muted" style={{ fontSize: 11.5, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</div>}
                      </td>
                      <td className="dtable__mono text-muted" style={{ fontSize: 12 }}>{p.version}</td>
                      <td className="text-muted">{p.size ? formatBytes(p.size) : '—'}</td>
                      <td><span className={`badge badge--${p.auto ? 'stopped' : 'running'}`} style={{ height: 20, padding: '0 7px', fontSize: 10.5 }}>{p.auto ? 'Abhäng.' : 'manuell'}</span></td>
                      <td><button className="btn btn--outline btn--sm" disabled={busy} onClick={() => remove([p.name], false)} title={tt('Paket entfernen')}><Trash2 size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 600 && <div style={{ textAlign: 'center', padding: 10, fontSize: 12, color: 'var(--color-muted)' }}>… {filtered.length - 600} weitere – bitte Filter eingrenzen.</div>}
            </div>
          </Panel>
        )}
      </main>

      <Modal open={installOpen} title={tt('Paket installieren')} onClose={() => { setInstallOpen(false); setQuery(''); setResults([]); }} width={620}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
          <input className="input input--rect" autoFocus placeholder={tt('Paket suchen (mind. 2 Zeichen)…')} value={query} onChange={(e) => runSearch(e.target.value)} style={{ width: '100%', paddingLeft: 32 }} />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {searching ? <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" style={{ width: 20, height: 20 }} /></div>
            : results.length === 0 ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-muted)', fontSize: 12.5 }}>{query.trim().length < 2 ? tt('Suchbegriff eingeben, um verfügbare Pakete zu finden.') : tt('Keine Treffer.')}</div>
              : results.map((r) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                    {r.summary && <div className="text-muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.summary}</div>}
                  </div>
                  {r.installed ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-success)' }}><CheckCircle2 size={13} /> {tt('installiert')}</span>
                    : <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => install(r.name)}><Download size={12} /> {tt('Installieren')}</button>}
                </div>
              ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11.5, color: 'var(--color-muted)' }}>
          <AlertTriangle size={13} /> {tt('Nur Pakete aus den konfigurierten System-Repositories werden installiert.')}
        </div>
      </Modal>

      <Modal open={outputOpen} title={tt('Ausgabe')} onClose={() => setOutputOpen(false)} width={680}>
        <div className="log-viewer" style={{ maxHeight: 460 }}>{output}</div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-success)', textAlign: 'right' }}>✓ Fertig – Fenster schließt automatisch…</div>
      </Modal>
    </>
  );
}
