import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Play, Square, RotateCcw, Trash2, ScrollText, SquareTerminal, ChevronDown, ArrowUpCircle, Download, ExternalLink, Pencil, X, Network, Globe } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { ContainerBadge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ContainerTerminal } from '../components/ContainerTerminal';
import { api } from '../lib/api';
import { timeAgo, avatarColor, containerInitial, germanStatus } from '../lib/utils';
import type { Container, CreateContainerData, DockerNetwork, HostInterface } from '../lib/types';

/** Container-Avatar: App-Icon (aus dem Store) mit Buchstaben-Fallback. */
function ContainerAvatar({ container }: { container: Container }) {
  const [err, setErr] = useState(false);
  // Upgrade HTTP → HTTPS to avoid mixed-content blocking on HTTPS pages
  const iconSrc = container.icon?.replace(/^http:\/\//i, 'https://') || null;
  if (iconSrc && !err) {
    return (
      <div className="container-avatar" style={{ background: '#fff', padding: 4 }}>
        <img src={iconSrc} alt={container.name} onError={() => setErr(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4 }} />
      </div>
    );
  }
  return (
    <div className="container-avatar" style={{ background: avatarColor(container.name) }}>
      {containerInitial(container.name)}
    </div>
  );
}

type Filter = 'all' | 'running' | 'stopped';

const CREATE_NEW = '__create_new__';

function NetworksPicker({ networks, onChange }: {
  networks: { id: string; name: string; ip: string }[];
  onChange: (nets: { id: string; name: string; ip: string }[]) => void;
}) {
  const [available, setAvailable] = useState<DockerNetwork[]>([]);
  const [interfaces, setInterfaces] = useState<HostInterface[]>([]);
  const [addId, setAddId] = useState('');
  const [pendingIp, setPendingIp] = useState('');
  const [creating, setCreating] = useState(false);
  const [newParent, setNewParent] = useState('');
  const [newSubnet, setNewSubnet] = useState('');
  const [newGw, setNewGw] = useState('');
  const [newVlan, setNewVlan] = useState('');
  const [newIp, setNewIp] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const reload = () => {
    api.networks.list().then((r) => setAvailable(r.networks.filter((n) => !n.builtin))).catch(() => {});
  };

  useEffect(() => {
    reload();
    api.networks.interfaces().then((r) => setInterfaces(r.interfaces)).catch(() => {});
  }, []);

  const add = () => {
    if (addId === CREATE_NEW) { setCreating(true); return; }
    if (!addId) return;
    const net = available.find((n) => n.id === addId);
    if (!net || networks.find((n) => n.id === addId)) return;
    onChange([...networks, { id: net.id, name: net.name, ip: pendingIp }]);
    setAddId(''); setPendingIp('');
  };

  const createAndAdd = async () => {
    if (!newParent) { setCreateErr('Bitte ein Interface (Parent) wählen.'); return; }
    if (!newSubnet) { setCreateErr('Subnetz (CIDR) ist erforderlich.'); return; }
    if (newIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(newIp)) { setCreateErr('Ungültige IP-Adresse.'); return; }
    setCreateBusy(true); setCreateErr('');
    const netName = `macvlan-${newParent}${newVlan ? '-' + newVlan : ''}`;
    try {
      await api.networks.create({ name: netName, driver: 'macvlan', parent: newParent, subnet: newSubnet, gateway: newGw || undefined, vlan: newVlan || undefined });
    } catch (e) {
      const msg = (e as { raw?: string }).raw ?? (e instanceof Error ? e.message : '');
      if (!/exists|in use/i.test(msg)) { setCreateErr(`Fehler: ${msg}`); setCreateBusy(false); return; }
    }
    try {
      const r = await api.networks.list();
      const all = r.networks.filter((n) => !n.builtin);
      setAvailable(all);
      const net = all.find((n) => n.name === netName);
      if (net) onChange([...networks, { id: net.id, name: net.name, ip: newIp }]);
    } catch { /* */ }
    setCreating(false); setCreateBusy(false);
    setNewParent(''); setNewSubnet(''); setNewGw(''); setNewVlan(''); setNewIp('');
    setAddId('');
  };

  const updateIp = (id: string, ip: string) => onChange(networks.map((n) => n.id === id ? { ...n, ip } : n));
  const remove = (id: string) => onChange(networks.filter((n) => n.id !== id));
  const unattached = available.filter((n) => !networks.find((m) => m.id === n.id));
  const selectedForAdd = unattached.find((n) => n.id === addId) ?? null;

  return (
    <div className="form-group">
      <label className="form-label">{tt('Netzwerk / IP-Adresse')}</label>
      <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginBottom: 6 }}>
        Mit einem Macvlan-Netzwerk bekommt der Container eine <strong>{tt('eigene IP im Heimnetz')}</strong> (kein Port-Mapping nötig).
      </div>

      {networks.map((n) => (
        <div key={n.id} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <Network size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span style={{ flex: '0 0 140px', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.name}>{n.name}</span>
          <input className="input input--rect" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder={tt('Feste IP (z.B. 192.168.1.200)')} value={n.ip}
            onChange={(e) => updateIp(n.id, e.target.value)} />
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => remove(n.id)} title={tt('Entfernen')}><X size={12} /></button>
        </div>
      ))}

      {creating && (
        <div style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 8 }}>{tt('Neues Macvlan-Netzwerk anlegen und verbinden:')}</div>
          {createErr && <div className="login-error" style={{ marginBottom: 8 }}>{createErr}</div>}
          <label className="form-label">Interface (Parent)</label>
          <select className="input input--rect" style={{ width: '100%', marginBottom: 8 }} value={newParent} onChange={(e) => setNewParent(e.target.value)}>
            <option value="">{tt('— wählen —')}</option>
            {interfaces.map((i) => <option key={i.iface} value={i.iface}>{i.iface}{i.ip4 ? ` (${i.ip4})` : ''}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 2 }}>
              <label className="form-label">Subnetz (CIDR)</label>
              <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                placeholder="192.168.1.0/24" value={newSubnet} onChange={(e) => setNewSubnet(e.target.value.trim())} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">VLAN (optional)</label>
              <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                placeholder={tt('z.B. 20')} value={newVlan} onChange={(e) => setNewVlan(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
          </div>
          <label className="form-label">{tt('Gateway')}</label>
          <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 8 }}
            placeholder="192.168.1.1" value={newGw} onChange={(e) => setNewGw(e.target.value.trim())} />
          <label className="form-label">{tt('Statische IP für diesen Container')}</label>
          <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 10 }}
            placeholder={tt('192.168.1.200 (leer = automatisch)')} value={newIp} onChange={(e) => setNewIp(e.target.value.trim())} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--primary btn--sm" onClick={() => void createAndAdd()} disabled={createBusy}>
              {createBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Plus size={12} />} Anlegen & verbinden
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => { setCreating(false); setAddId(''); setCreateErr(''); }}>{tt('Abbrechen')}</button>
          </div>
        </div>
      )}

      {!creating && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <select className="input input--rect" style={{ flex: 1, minWidth: 180, cursor: 'pointer', fontSize: 12 }} value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">{tt('— Netzwerk hinzufügen …')}</option>
            {unattached.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.driver}{n.subnet ? ', ' + n.subnet : ''})</option>)}
            <option value={CREATE_NEW}>{tt('＋ Neues Macvlan anlegen…')}</option>
          </select>
          {selectedForAdd && (
            <input className="input input--rect" style={{ width: 190, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder={tt('IP (optional)')} value={pendingIp} onChange={(e) => setPendingIp(e.target.value.trim())} />
          )}
          <button className="btn btn--outline btn--sm" onClick={add} disabled={!addId}><Plus size={12} /> {tt('Hinzufügen')}</button>
        </div>
      )}
    </div>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateContainerData>({ image: '', name: '', restart: 'unless-stopped' });
  const [portStr, setPortStr] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [volStr, setVolStr] = useState('');
  const [extraNets, setExtraNets] = useState<{ id: string; name: string; ip: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setForm({ image: '', name: '', restart: 'unless-stopped' });
    setPortStr(''); setEnvStr(''); setVolStr(''); setExtraNets([]); setError('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!form.image.trim()) { setError('Image ist erforderlich'); return; }
    setLoading(true); setError('');
    try {
      const ports: Record<string, string> = {};
      portStr.split('\n').forEach((l) => {
        const [host, container] = l.trim().split(':');
        if (host && container) ports[container] = host;
      });
      const networks = extraNets.map((n) => ({ id: n.id, ip: n.ip || undefined }));
      await api.containers.create({
        ...form,
        ports: Object.keys(ports).length ? ports : undefined,
        env: envStr.split('\n').map((l) => l.trim()).filter(Boolean) || undefined,
        volumes: volStr.split('\n').map((l) => l.trim()).filter(Boolean) || undefined,
        networks: networks.length ? networks : undefined,
      });
      reset(); onCreated(); onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
    } finally {
      setLoading(false);
    }
  };

  const field = (key: keyof CreateContainerData, label: string, placeholder: string, required = false) => (
    <div className="form-group">
      <label className="form-label">{label}{required ? ' *' : ''}</label>
      <input
        className="input input--rect"
        placeholder={placeholder}
        value={(form[key] as string) ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        required={required}
      />
    </div>
  );

  return (
    <Modal
      open={open}
      title={tt('Neuer Container')}
      onClose={handleClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={handleClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={handleCreate} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}
            Container erstellen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      {field('image', 'Image', 'z.B. nginx:latest', true)}
      {field('name', 'Container-Name', 'z.B. mein-nginx')}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Neustart-Richtlinie')}</label>
          <select
            className="input input--rect"
            value={form.restart ?? 'unless-stopped'}
            onChange={(e) => setForm((f) => ({ ...f, restart: e.target.value }))}
            style={{ cursor: 'pointer' }}
          >
            <option value="unless-stopped">{tt('Außer wenn manuell gestoppt')}</option>
            <option value="always">{tt('Immer neu starten')}</option>
            <option value="on-failure">{tt('Nur bei Fehler')}</option>
            <option value="no">Nie (kein Autostart)</option>
          </select>
        </div>
        {field('category', 'Gruppe / Kategorie', 'z.B. Datenbanken')}
      </div>
      <div className="form-group">
        <label className="form-label">Icon-URL (optional)</label>
        <input
          className="input input--rect"
          placeholder={tt('https://…/icon.png – leer = Buchstaben-Symbol')}
          value={form.icon ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
        />
        {form.icon ? (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--color-subtle)' }}>
            <img src={form.icon.replace(/^http:\/\//i, 'https://')} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4, background: '#fff' }}
              onError={(e) => { (e.currentTarget.style.display = 'none'); }} />
            Vorschau
          </div>
        ) : null}
      </div>
      <div className="form-group">
        <label className="form-label">Ports (eine pro Zeile: host:container)</label>
        <textarea
          className="input input--rect"
          placeholder={'8080:80\n8443:443'}
          value={portStr}
          onChange={(e) => setPortStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Umgebungsvariablen (eine pro Zeile: KEY=VALUE)</label>
        <textarea
          className="input input--rect"
          placeholder={'PUID=1000\nPGID=1000\nTZ=Europe/Berlin'}
          value={envStr}
          onChange={(e) => setEnvStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Volumes (eine pro Zeile: /host:/container)</label>
        <textarea
          className="input input--rect"
          placeholder={'/opt/appdata/nginx:/config\n/mnt/data:/data'}
          value={volStr}
          onChange={(e) => setVolStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
      <NetworksPicker networks={extraNets} onChange={setExtraNets} />
    </Modal>
  );
}

function LogsModal({ container, open, onClose }: { container: Container | null; open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !container) return;
    setLoading(true);
    api.containers.logs(container.id, 300)
      .then(({ logs }) => setLogs(logs))
      .catch(() => setLogs(['Fehler beim Laden der Logs']))
      .finally(() => setLoading(false));
  }, [open, container]);

  return (
    <Modal open={open} title={`Logs: ${container?.name ?? ''}`} onClose={onClose} width={680}>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <span className="spinner" />
        </div>
      ) : (
        <div className="log-viewer" style={{ maxHeight: 460 }}>
          {logs.length ? logs.join('\n') : 'Keine Logs verfügbar'}
        </div>
      )}
    </Modal>
  );
}

export function Containers() {
  const t = useT();
  const [containers, setContainers] = useState<Container[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [catFilter, setCatFilter] = useState<string>('');   // '' = alle Kategorien
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<Container | null>(null);
  const [execContainer, setExecContainer] = useState<Container | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, { hasUpdate: boolean | null; image: string }>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Container | null>(null);
  // Aufgeklappte/zugeklappte Gruppen (in localStorage gemerkt)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('container-groups-collapsed') || '[]')); }
    catch { return new Set(); }
  });
  // Entwurf für Icon/Gruppe im aufgeklappten Container
  const [metaIcon, setMetaIcon] = useState('');
  const [metaCat, setMetaCat] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const { containers } = await api.containers.list();
      setContainers(containers);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const checkUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try { const { updates } = await api.containers.updates(); setUpdates(updates); }
    catch { /* ignore */ }
    finally { setCheckingUpdates(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const action = async (id: string, act: string, fn: () => Promise<unknown>) => {
    setActionLoading((a) => ({ ...a, [id]: act }));
    try {
      await fn();
      await load(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setActionLoading((a) => { const n = { ...a }; delete n[id]; return n; });
    }
  };

  // Container auf-/zuklappen und dabei den Icon/Gruppe-Entwurf vorbelegen
  const toggleExpand = (c: Container) => {
    if (expandedId === c.id) { setExpandedId(null); return; }
    setExpandedId(c.id);
    setMetaIcon(c.icon ?? '');
    setMetaCat(c.category ?? '');
  };

  const saveMeta = async (c: Container) => {
    setSavingMeta(true);
    try {
      await api.containers.setIcon(c.id, metaIcon.trim());
      await api.containers.setCategory(c.id, metaCat.trim());
      await load(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSavingMeta(false);
    }
  };

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      try { localStorage.setItem('container-groups-collapsed', JSON.stringify([...n])); } catch { /* */ }
      return n;
    });
  };

  const GROUP_NONE = 'Ohne Gruppe';

  // Vorhandene Kategorien (dynamisch aus den Containern) – für die Tab-Leiste oben
  const allCategories = [...new Set(containers.map((c) => (c.category && c.category.trim()) || GROUP_NONE))]
    .sort((a, b) => {
      if (a === GROUP_NONE) return 1;
      if (b === GROUP_NONE) return -1;
      return a.localeCompare(b, 'de');
    });

  const filtered = containers.filter((c) => {
    if (filter === 'running' && c.state !== 'running') return false;
    if (filter === 'stopped' && c.state === 'running') return false;
    if (catFilter) {
      const cat = (c.category && c.category.trim()) || GROUP_NONE;
      if (cat !== catFilter) return false;
    }
    return true;
  });

  const running = containers.filter((c) => c.state === 'running').length;
  const catCount = (cat: string) => containers.filter((c) => ((c.category && c.category.trim()) || GROUP_NONE) === cat).length;

  // Container nach Gruppe/Kategorie bündeln (ohne Kategorie → "Ohne Gruppe", ganz unten)
  const groupMap = new Map<string, Container[]>();
  for (const c of filtered) {
    const key = (c.category && c.category.trim()) || GROUP_NONE;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(c);
  }
  const groups = [...groupMap.entries()].sort((a, b) => {
    if (a[0] === GROUP_NONE) return 1;
    if (b[0] === GROUP_NONE) return -1;
    return a[0].localeCompare(b[0], 'de');
  });
  const hasGroups = groups.some(([name]) => name !== GROUP_NONE);

  const renderCard = (c: Container) => {
    const busy = actionLoading[c.id];
    const isExpanded = expandedId === c.id;
    return (
      <div className="container-card" key={c.id}>
        <div className="container-card__header">
          <ContainerAvatar container={c} />
          <div className="container-card__info">
            <Link to={`/containers/${c.id}`} className="container-card__name" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              {c.name} <ExternalLink size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
            </Link>
            <div className="container-card__image">{c.image}</div>
          </div>
          {updates[c.id]?.hasUpdate && (
            <span className="badge badge--restarting" title={tt('Neues Image verfügbar')}>
              <ArrowUpCircle size={11} /> Update
            </span>
          )}
          {c.state === 'running' && c.ports.length > 0 && (() => {
            const hostPort = c.ports[0].split(':')[0];
            const href = `http://${window.location.hostname}:${hostPort}`;
            return (
              <a className="icon-btn" href={href} target="_blank" rel="noreferrer"
                title={`${tt('Im Browser öffnen')}: ${href}`} onClick={(e) => e.stopPropagation()}>
                <Globe size={14} />
              </a>
            );
          })()}
          <ContainerBadge state={c.state} />
          <button
            className="icon-btn"
            onClick={() => toggleExpand(c)}
            style={{ marginLeft: 4 }}
            title={isExpanded ? 'Zuklappen' : 'Details / Icon & Gruppe'}
          >
            <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
          </button>
        </div>

        {c.ports.length > 0 && (
          <div className="container-card__ports">
            {c.ports.map((p) => {
              const [hostPort] = p.split(':');
              const href = `http://${window.location.hostname}:${hostPort}`;
              return (
                <a key={p} href={href} target="_blank" rel="noreferrer"
                  className="port-chip"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  title={`Öffnen: ${href}`}>
                  {p} <ExternalLink size={8} style={{ opacity: 0.6, flexShrink: 0 }} />
                </a>
              );
            })}
          </div>
        )}

        {isExpanded && (
          <div style={{ padding: '0 16px 10px', fontSize: 11.5, color: 'var(--color-subtle)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div><span style={{ color: 'var(--color-faint)' }}>ID: </span><span style={{ fontFamily: 'var(--font-mono)' }}>{c.shortId}</span></div>
            <div><span style={{ color: 'var(--color-faint)' }}>{tt('Erstellt:')} </span>{timeAgo(c.created)}</div>
            <div><span style={{ color: 'var(--color-faint)' }}>{tt('Status:')} </span>{germanStatus(c.status)}</div>
            {c.ports.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                {c.ports.map((p) => {
                  const [hostPort, containerPort] = p.split(':');
                  const href = `http://${window.location.hostname}:${hostPort}`;
                  return (
                    <div key={p}>
                      <span style={{ color: 'var(--color-faint)' }}>{tt('Port:')} </span>
                      <a href={href} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--color-accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {window.location.hostname}:{hostPort}
                      </a>
                      <span style={{ color: 'var(--color-faint)' }}> → Container {containerPort}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Icon & Gruppe direkt bearbeiten */}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--color-fg)' }}>Icon &amp; Gruppe</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {metaIcon.trim() ? (
                  <img src={metaIcon.replace(/^http:\/\//i, 'https://')} alt="" style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4, background: '#fff', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                ) : (
                  <div style={{ width: 26, height: 26, borderRadius: 4, background: avatarColor(c.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{containerInitial(c.name)}</div>
                )}
                <input className="input input--rect" placeholder={tt('Icon-URL (leer = Buchstabe)')} value={metaIcon}
                  onChange={(e) => setMetaIcon(e.target.value)} style={{ flex: 1, height: 32, fontSize: 12 }} />
              </div>
              <input className="input input--rect" placeholder={tt('Gruppe / Kategorie (z.B. Datenbanken)')} value={metaCat}
                onChange={(e) => setMetaCat(e.target.value)} style={{ height: 32, fontSize: 12 }}
                list="container-group-list" />
              <datalist id="container-group-list">
                {[...new Set(containers.map((x) => x.category).filter(Boolean))].map((g) => <option key={g} value={g!} />)}
              </datalist>
              <div>
                <button className="btn btn--primary btn--sm" disabled={savingMeta} onClick={() => saveMeta(c)}>
                  {savingMeta ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null} Speichern
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="container-card__footer">
          <span className="container-card__status-text">{germanStatus(c.status)}</span>

          {c.state !== 'running' && (
            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Starten')} disabled={!!busy}
              onClick={() => action(c.id, 'start', () => api.containers.start(c.id))}>
              {busy === 'start' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
            </button>
          )}
          {c.state === 'running' && (
            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Stoppen')} disabled={!!busy}
              onClick={() => action(c.id, 'stop', () => api.containers.stop(c.id))}>
              {busy === 'stop' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Square size={12} />}
            </button>
          )}
          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Neustart')} disabled={!!busy}
            onClick={() => action(c.id, 'restart', () => api.containers.restart(c.id))}>
            {busy === 'restart' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={12} />}
          </button>
          {c.state === 'running' && (
            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Konsole im Container öffnen')}
              onClick={() => { setExecContainer(c); }}>
              <SquareTerminal size={12} />
            </button>
          )}
          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Logs')} onClick={() => { setLogContainer(c); }}>
            <ScrollText size={12} />
          </button>
          {updates[c.id]?.hasUpdate && (
            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Neues Image laden (Update)')}
              style={{ color: 'var(--color-warning)' }} disabled={!!busy}
              onClick={() => action(c.id, 'pull', async () => { await api.containers.pull(c.id); await checkUpdates(); })}>
              {busy === 'pull' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={12} />}
            </button>
          )}
          <Link to={`/containers/${c.id}`} className="btn btn--ghost btn--icon btn--sm" title={tt('Konfiguration bearbeiten')}>
            <Pencil size={12} />
          </Link>
          <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={!!busy}
            onClick={() => setDeleteConfirm(c)}>
            {busy === 'remove' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Topbar
        title={t('nav.containers')}
        subtitle={t('page.containers.subtitle', { running, total: containers.length })}
        onRefresh={() => load()}
        refreshing={refreshing}
        actions={
          <>
            <button className="btn btn--outline btn--sm" onClick={checkUpdates} disabled={checkingUpdates}>
              {checkingUpdates ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ArrowUpCircle size={13} />}
              Updates prüfen
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} />
              Neuer Container
            </button>
          </>
        }
      />

      <main className="page">
        <div className="filter-tabs">
          {(['all', 'running', 'stopped'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`filter-tab${filter === f ? ' filter-tab--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `Alle (${containers.length})` : f === 'running' ? `Läuft (${running})` : `Gestoppt (${containers.length - running})`}
            </button>
          ))}
        </div>

        {/* Dynamische Kategorie-Tabs – erscheinen automatisch, sobald Gruppen vergeben sind */}
        {allCategories.length > 1 && (
          <div className="filter-tabs" style={{ flexWrap: 'wrap', gap: 4, marginTop: -4 }}>
            <button
              className={`filter-tab${!catFilter ? ' filter-tab--active' : ''}`}
              onClick={() => setCatFilter('')}
            >
              Alle Gruppen
            </button>
            {allCategories.map((c) => (
              <button
                key={c}
                className={`filter-tab${catFilter === c ? ' filter-tab--active' : ''}`}
                onClick={() => setCatFilter(catFilter === c ? '' : c)}
              >
                {c} ({catCount(c)})
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <span className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" style={{ fontSize: 44 }}>📦</div>
            <div className="empty-state__title">{tt('Keine Container gefunden')}</div>
            <div className="empty-state__desc">{tt('Erstelle deinen ersten Container mit dem Button oben rechts.')}</div>
          </div>
        ) : (
          hasGroups ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {groups.map(([name, items]) => {
                const collapsed = collapsedGroups.has(name);
                const groupRunning = items.filter((x) => x.state === 'running').length;
                return (
                  <div key={name}>
                    <button className="container-group__header" onClick={() => toggleGroup(name)}>
                      <ChevronDown size={15} style={{ transform: collapsed ? 'rotate(-90deg)' : '', transition: 'transform 0.2s', flexShrink: 0 }} />
                      <span className="container-group__title">{name}</span>
                      <span className="container-group__count">{groupRunning} läuft · {items.length}</span>
                    </button>
                    {!collapsed && (
                      <div className="container-grid" style={{ marginTop: 8 }}>
                        {items.map(renderCard)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="container-grid">
              {filtered.map(renderCard)}
            </div>
          )
        )}
      </main>

      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void load()}
      />
      <LogsModal
        container={logContainer}
        open={!!logContainer}
        onClose={() => setLogContainer(null)}
      />
      {execContainer && (
        <ContainerTerminal
          id={execContainer.id}
          name={execContainer.name}
          onClose={() => setExecContainer(null)}
        />
      )}
      <ConfirmModal
        open={!!deleteConfirm}
        title={tt('Container löschen')}
        message={`Soll "${deleteConfirm?.name}" wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.`}
        confirmLabel="Löschen"
        danger
        onConfirm={() => {
          if (deleteConfirm) {
            void action(deleteConfirm.id, 'remove', () => api.containers.remove(deleteConfirm.id));
          }
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
