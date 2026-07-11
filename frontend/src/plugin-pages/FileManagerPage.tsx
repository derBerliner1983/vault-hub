import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, FileText, ChevronRight, Home, Trash2, Download, Upload, FolderPlus, Edit3, Save, X, Shield, ArrowLeft, Pencil } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { formatBytes } from '../lib/utils';

const API = '/app/filemanager/api';

interface Entry {
  name: string; path: string; isDir: boolean; isSymlink: boolean;
  size: number; permissions: string; mode: number;
  isExecutable: boolean; ownerExecutable: boolean; groupExecutable: boolean; otherExecutable: boolean;
  owner: string; group: string; mtime: string;
}

async function freq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> ?? {}) } });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`); }
  return res.json() as Promise<T>;
}
function permStr(mode: number): string {
  const bits = (mode & 0o777);
  const sym = (n: number) => [(n & 4) ? 'r' : '-', (n & 2) ? 'w' : '-', (n & 1) ? 'x' : '-'].join('');
  return sym(bits >> 6) + sym((bits >> 3) & 7) + sym(bits & 7);
}
function FileIcon({ entry }: { entry: Entry }) {
  if (entry.isDir) return <Folder size={15} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />;
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'conf', 'cfg', 'ini', 'sh', 'env', 'log', 'xml', 'html', 'css', 'js', 'ts'].includes(ext))
    return <FileText size={15} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />;
  return <File size={15} style={{ color: 'var(--color-faint)', flexShrink: 0 }} />;
}
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'conf', 'cfg', 'ini', 'sh', 'env', 'log', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rb', 'php', 'sql', 'csv', 'dockerfile', 'Dockerfile']);

export function FileManagerPage() {
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editPath, setEditPath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [chmodPath, setChmodPath] = useState<string | null>(null);
  const [chmodMode, setChmodMode] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (dir: string) => {
    setLoading(true); setError(''); setSelected(null);
    try {
      const data = await freq<{ path: string; entries: Entry[]; parent: string | null }>(`${API}/list?path=${encodeURIComponent(dir)}`);
      setCwd(data.path); setEntries(data.entries); setParent(data.parent);
    } catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(cwd); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = (dir: string) => { setEditPath(null); setChmodPath(null); void load(dir); };

  const openEdit = async (entry: Entry) => {
    setError('');
    try { const data = await freq<{ content: string }>(`${API}/read?path=${encodeURIComponent(entry.path)}`); setEditContent(data.content); setEditPath(entry.path); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };
  const saveEdit = async () => {
    if (!editPath) return; setEditSaving(true);
    try { await freq(`${API}/write`, { method: 'POST', body: JSON.stringify({ path: editPath, content: editContent }) }); setEditPath(null); void load(cwd); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); } finally { setEditSaving(false); }
  };
  const deleteEntry = async (entry: Entry) => {
    if (!confirm(`„${entry.name}" ${entry.isDir ? 'und gesamten Inhalt' : ''} löschen?`)) return;
    try { await freq(`${API}?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' }); void load(cwd); } catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };
  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try { await freq(`${API}/mkdir`, { method: 'POST', body: JSON.stringify({ path: cwd.replace(/\/$/, '') + '/' + newFolderName.trim() }) }); setNewFolderName(''); setShowNewFolder(false); void load(cwd); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };
  const applyChmod = async () => {
    if (!chmodPath) return;
    try { await freq(`${API}/chmod`, { method: 'POST', body: JSON.stringify({ path: chmodPath, mode: chmodMode }) }); setChmodPath(null); void load(cwd); } catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };
  const applyRename = async () => {
    if (!renamePath || !renameTo.trim()) return;
    const dir = renamePath.split('/').slice(0, -1).join('/') || '/';
    try { await freq(`${API}/rename`, { method: 'POST', body: JSON.stringify({ from: renamePath, to: dir + '/' + renameTo.trim() }) }); setRenamePath(null); void load(cwd); } catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData(); for (const f of files) form.append('file', f);
    try { const res = await fetch(`${API}/upload?path=${encodeURIComponent(cwd)}`, { method: 'POST', body: form, credentials: 'include' }); if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`); } void load(cwd); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
  };

  const crumbs = cwd.split('/').filter(Boolean);

  return (
    <>
      <Topbar title={tt('Datei-Manager')} subtitle={cwd} onRefresh={() => void load(cwd)} refreshing={loading}
        actions={<div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--ghost btn--sm" onClick={() => uploadRef.current?.click()}><Upload size={12} /> {tt('Hochladen')}</button>
          <button className="btn btn--ghost btn--sm" onClick={() => setShowNewFolder((f) => !f)}><FolderPlus size={12} /> {tt('Ordner')}</button>
          <input ref={uploadRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => void uploadFiles(e.target.files)} />
        </div>} />
      <main className="page">
        {error && (
          <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid var(--color-error)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--color-error)', display: 'flex', gap: 10 }}>
            <span style={{ flex: 1 }}>✗ {error}</span><button className="btn btn--ghost btn--sm" onClick={() => setError('')}>×</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, fontSize: 13, flexWrap: 'wrap' }}>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => navigate('/')} title={tt('Root')}><Home size={13} /></button>
          {parent && <button className="btn btn--ghost btn--icon btn--sm" onClick={() => navigate(parent)} title={tt('Zurück')}><ArrowLeft size={13} /></button>}
          {crumbs.map((seg, i) => {
            const to = '/' + crumbs.slice(0, i + 1).join('/');
            return <span key={to} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ChevronRight size={11} style={{ color: 'var(--color-faint)' }} /><button className="btn btn--ghost btn--sm" style={{ padding: '1px 6px', fontSize: 12 }} onClick={() => navigate(to)}>{seg}</button></span>;
          })}
        </div>
        {showNewFolder && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="input input--rect" placeholder={tt('Ordnername…')} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createFolder()} style={{ width: 220, height: 32 }} autoFocus />
            <button className="btn btn--primary btn--sm" onClick={() => void createFolder()}>{tt('Erstellen')}</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowNewFolder(false)}>{tt('Abbrechen')}</button>
          </div>
        )}
        <div className="panel">
          <div className="table-scroll">
            <table className="dtable">
              <thead><tr>
                <th style={{ width: 24 }}></th><th>{tt('Name')}</th><th style={{ width: 100 }}>{tt('Rechte')}</th>
                <th style={{ width: 90 }}>{tt('Benutzer')}</th><th style={{ width: 90 }}>{tt('Gruppe')}</th>
                <th className="dtable__num" style={{ width: 80 }}>{tt('Größe')}</th><th style={{ width: 80 }}>{tt('Ausführbar')}</th>
                <th style={{ width: 130 }}>{tt('Geändert')}</th><th style={{ width: 150 }}></th>
              </tr></thead>
              <tbody>
                {entries.length === 0 && !loading && (<tr><td colSpan={9} style={{ textAlign: 'center', padding: '20px', color: 'var(--color-faint)', fontSize: 13 }}>{tt('Verzeichnis ist leer')}</td></tr>)}
                {entries.map((entry) => {
                  const isText = !entry.isDir && TEXT_EXTS.has(entry.name.split('.').pop()?.toLowerCase() ?? '');
                  const sel = selected === entry.path;
                  return (
                    <tr key={entry.path} style={{ background: sel ? 'var(--color-accent-soft)' : undefined }} onClick={() => setSelected(sel ? null : entry.path)}>
                      <td style={{ paddingRight: 0 }}><FileIcon entry={entry} /></td>
                      <td><button className="btn btn--ghost btn--sm" style={{ fontWeight: entry.isDir ? 600 : 400, textAlign: 'left', padding: '0 4px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); entry.isDir ? navigate(entry.path) : (isText ? void openEdit(entry) : undefined); }} title={entry.path}>{entry.name}{entry.isSymlink ? ' →' : ''}</button></td>
                      <td className="dtable__mono" style={{ fontSize: 11.5 }}><span title={entry.permissions}>{permStr(entry.mode)}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>{entry.owner || '–'}</td>
                      <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>{entry.group || '–'}</td>
                      <td className="dtable__num" style={{ fontSize: 12 }}>{entry.isDir ? '–' : formatBytes(entry.size)}</td>
                      <td style={{ fontSize: 11.5 }}><span style={{ display: 'flex', gap: 4 }}>
                        {entry.ownerExecutable && <span style={{ background: 'rgba(34,197,94,.15)', color: 'var(--color-success)', padding: '1px 5px', borderRadius: 3, fontSize: 10.5 }}>u+x</span>}
                        {entry.groupExecutable && <span style={{ background: 'rgba(52,211,153,.12)', color: 'var(--color-accent)', padding: '1px 5px', borderRadius: 3, fontSize: 10.5 }}>g+x</span>}
                        {entry.otherExecutable && <span style={{ background: 'rgba(234,179,8,.12)', color: 'var(--color-warning)', padding: '1px 5px', borderRadius: 3, fontSize: 10.5 }}>o+x</span>}
                      </span></td>
                      <td style={{ fontSize: 11, color: 'var(--color-faint)' }}>{new Date(entry.mtime).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td onClick={(e) => e.stopPropagation()}><div className="dtable__actions">
                        {isText && <button className="btn btn--ghost btn--icon btn--sm" title={tt('Bearbeiten')} onClick={() => void openEdit(entry)}><Edit3 size={12} /></button>}
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Berechtigungen')} onClick={() => { setChmodPath(entry.path); setChmodMode(entry.permissions); }}><Shield size={12} /></button>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Umbenennen')} onClick={() => { setRenamePath(entry.path); setRenameTo(entry.name); }}><Pencil size={12} /></button>
                        {!entry.isDir && <a className="btn btn--ghost btn--icon btn--sm" href={`${API}/download?path=${encodeURIComponent(entry.path)}`} download title={tt('Herunterladen')}><Download size={12} /></a>}
                        <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} onClick={() => void deleteEntry(entry)}><Trash2 size={12} /></button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {chmodPath && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setChmodPath(null)}>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, minWidth: 340 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{tt('Berechtigungen ändern')}</div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 14 }}>{chmodPath}</div>
              <ChmodEditor mode={chmodMode} onChange={setChmodMode} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void applyChmod()}>{tt('Anwenden')}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setChmodPath(null)}>{tt('Abbrechen')}</button>
              </div>
            </div>
          </div>
        )}
        {renamePath && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRenamePath(null)}>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, minWidth: 340 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>{tt('Umbenennen')}</div>
              <input className="input input--rect" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void applyRename()} style={{ width: '100%', height: 34 }} autoFocus />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void applyRename()}>{tt('Umbenennen')}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setRenamePath(null)}>{tt('Abbrechen')}</button>
              </div>
            </div>
          </div>
        )}
        {editPath && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', flexDirection: 'column', padding: 24 }}>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '90vh' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                <FileText size={14} /><span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editPath}</span>
                <button className="btn btn--primary btn--sm" onClick={() => void saveEdit()} disabled={editSaving}>{editSaving ? <><span className="spinner" style={{ width: 11, height: 11 }} /> {tt('Speichern…')}</> : <><Save size={12} /> {tt('Speichern')}</>}</button>
                <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setEditPath(null)}><X size={14} /></button>
              </div>
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'var(--color-surface-sunken)', fontFamily: 'monospace', fontSize: 13, padding: '12px 16px', color: 'var(--color-fg)', lineHeight: 1.6 }} spellCheck={false} />
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function ChmodEditor({ mode, onChange }: { mode: string; onChange: (m: string) => void }) {
  const oct = parseInt(mode, 8) || 0o644;
  const bit = (pos: number) => !!(oct & pos);
  const toggle = (pos: number) => onChange(((oct ^ pos) & 0o777).toString(8).padStart(4, '0'));
  const rows = [{ label: 'Besitzer', r: 0o400, w: 0o200, x: 0o100 }, { label: 'Gruppe', r: 0o040, w: 0o020, x: 0o010 }, { label: 'Andere', r: 0o004, w: 0o002, x: 0o001 }];
  return (
    <div>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead><tr><th style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--color-muted)', fontWeight: 400 }}></th>{['Lesen', 'Schreiben', 'Ausführen'].map((h) => <th key={h} style={{ textAlign: 'center', color: 'var(--color-muted)', fontWeight: 400 }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ paddingRight: 12, paddingBottom: 6 }}>{row.label}</td>
              {[['r', row.r], ['w', row.w], ['x', row.x]].map(([, pos]) => (
                <td key={String(pos)} style={{ textAlign: 'center', paddingBottom: 6 }}><input type="checkbox" checked={bit(Number(pos))} onChange={() => toggle(Number(pos))} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-muted)' }}>Octal: <code style={{ fontFamily: 'monospace', background: 'var(--color-surface-sunken)', padding: '1px 6px', borderRadius: 4 }}>{mode}</code></div>
    </div>
  );
}
