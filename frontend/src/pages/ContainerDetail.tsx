import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Square, RotateCcw, Trash2, RefreshCw, ChevronDown, ChevronRight, SquareTerminal, Pencil, ExternalLink, Plus, X, Network } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { ContainerBadge } from '../components/ui/Badge';
import { Sparkline } from '../components/ui/Sparkline';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Modal } from '../components/ui/Modal';
import { ContainerTerminal } from '../components/ContainerTerminal';
import { api } from '../lib/api';
import { formatBytes, germanStatus, germanRestart } from '../lib/utils';
import type { Container, DockerNetwork, HostInterface } from '../lib/types';

const HISTORY_LEN = 40;
const STATS_INTERVAL_MS = 3000;

function stateBadge(state: string) {
  return <ContainerBadge state={state} />;
}

interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Image: string; Env: string[] | null; Labels: Record<string, string> };
  State: { Status: string; StartedAt: string; FinishedAt: string; Pid: number };
  HostConfig: {
    RestartPolicy: { Name: string };
    Binds: string[] | null;
    PortBindings?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
  };
  NetworkSettings: {
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
    Networks: Record<string, { NetworkID: string; IPAddress: string; MacAddress: string }>;
  };
  Created: string;
}

interface PortLine { host: number; container: number; proto: string }

/** Liest die Port-Mappings (bevorzugt aus HostConfig.PortBindings, sonst NetworkSettings). */
function readPortLines(inspect: ContainerInspect | null): PortLine[] {
  const src = inspect?.HostConfig.PortBindings && Object.keys(inspect.HostConfig.PortBindings).length
    ? inspect.HostConfig.PortBindings
    : inspect?.NetworkSettings.Ports;
  const out: PortLine[] = [];
  for (const [key, bindings] of Object.entries(src ?? {})) {
    if (!bindings) continue;
    const [cport, proto] = key.split('/');
    for (const b of bindings) {
      if (b.HostPort) out.push({ host: parseInt(b.HostPort, 10), container: parseInt(cport, 10), proto: proto || 'tcp' });
    }
  }
  return out;
}

// ── Reconfigure / Edit modal ─────────────────────────────────────────────────

const CREATE_NEW = '__create_new__';

function NetworksPicker({ networks, onChange }: {
  networks: { id: string; name: string; ip: string }[];
  onChange: (nets: { id: string; name: string; ip: string }[]) => void;
}) {
  const [available, setAvailable] = useState<DockerNetwork[]>([]);
  const [interfaces, setInterfaces] = useState<HostInterface[]>([]);
  const [addId, setAddId] = useState('');
  const [pendingIp, setPendingIp] = useState('');
  // Felder für neues Macvlan
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
    // Netzwerke neu laden und das neue direkt hinzufügen
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

      {/* Neues Macvlan inline anlegen */}
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
            <button className="btn btn--primary btn--sm" onClick={createAndAdd} disabled={createBusy}>
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

function EditModal({ container, inspect, onClose, onDone }: {
  container: Container;
  inspect: ContainerInspect | null;
  onClose: () => void;
  onDone: (newId: string) => void;
}) {
  const [image, setImage] = useState('');
  const [name, setName] = useState('');
  const [restart, setRestart] = useState('unless-stopped');
  const [portStr, setPortStr] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [volStr, setVolStr] = useState('');
  const [extraNets, setExtraNets] = useState<{ id: string; name: string; ip: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setImage(inspect?.Config.Image ?? container.image);
    setName(container.name);
    setRestart(inspect?.HostConfig.RestartPolicy?.Name || 'unless-stopped');
    setPortStr(readPortLines(inspect).map((p) => `${p.host}:${p.container}${p.proto === 'udp' ? '/udp' : ''}`).join('\n'));
    const env = (inspect?.Config.Env ?? []).filter((e) => !e.startsWith('PATH=') && !e.startsWith('HOME='));
    setEnvStr(env.join('\n'));
    setVolStr((inspect?.HostConfig.Binds ?? []).join('\n'));
    // Pre-populate extra networks from current inspect (non-default)
    const currentNets = Object.entries(inspect?.NetworkSettings.Networks ?? {})
      .filter(([netName]) => netName !== 'bridge' && netName !== 'host' && netName !== 'none')
      .map(([netName, info]) => ({ id: info.NetworkID, name: netName, ip: info.IPAddress || '' }));
    setExtraNets(currentNets);
    setError('');
  }, [container, inspect]);

  const save = async () => {
    if (!image.trim()) { setError('Image ist erforderlich'); return; }
    setBusy(true); setError('');
    try {
      const ports = portStr.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        const [host, rest] = line.split(':');
        const [cport, proto] = (rest ?? '').split('/');
        return { host: parseInt(host, 10), container: parseInt(cport, 10), proto: proto === 'udp' ? 'udp' : 'tcp' };
      }).filter((p) => p.host && p.container);
      const env = envStr.split('\n').map((l) => l.trim()).filter(Boolean);
      const volumes = volStr.split('\n').map((l) => l.trim()).filter(Boolean);
      const networks = extraNets.map((n) => ({ id: n.id, ip: n.ip || undefined }));
      const res = await api.containers.recreate(container.id, {
        name: name.trim() || container.name,
        image: image.trim(),
        ports, env, volumes, restart,
        category: container.category ?? undefined,
        networks: networks.length ? networks : undefined,
      });
      onDone(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neu-Erstellen fehlgeschlagen');
    } finally { setBusy(false); }
  };

  const ta = { height: 'auto', resize: 'vertical' as const, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 };

  return (
    <Modal
      open
      title={tt('Container neu konfigurieren')}
      onClose={onClose}
      width={660}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={13} />} Übernehmen & neu starten
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 12, lineHeight: 1.5 }}>
        ⚠️ Der Container wird mit der neuen Konfiguration neu erstellt. Named-Volumes (und damit deine Daten) bleiben erhalten.
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Image')}</label>
        <input className="input input--rect" value={image} onChange={(e) => setImage(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Container-Name')}</label>
          <input className="input input--rect" value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '_'))} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Neustart-Richtlinie')}</label>
          <select className="input input--rect" value={restart} onChange={(e) => setRestart(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="unless-stopped">{tt('Außer wenn manuell gestoppt')}</option>
            <option value="always">{tt('Immer neu starten')}</option>
            <option value="on-failure">{tt('Nur bei Fehler')}</option>
            <option value="no">Nie (kein Autostart)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Ports (eine pro Zeile: host:container, optional /udp)</label>
        <textarea className="input input--rect" value={portStr} onChange={(e) => setPortStr(e.target.value)} rows={3} style={ta} placeholder={'8080:80\n53:53/udp'} />
      </div>
      <div className="form-group">
        <label className="form-label">Umgebungsvariablen (eine pro Zeile: KEY=VALUE)</label>
        <textarea className="input input--rect" value={envStr} onChange={(e) => setEnvStr(e.target.value)} rows={4} style={ta} placeholder={'PUID=1000\nTZ=Europe/Berlin'} />
      </div>
      <div className="form-group">
        <label className="form-label">Volumes (eine pro Zeile: host_oder_name:/container)</label>
        <textarea className="input input--rect" value={volStr} onChange={(e) => setVolStr(e.target.value)} rows={3} style={ta} placeholder={'/opt/appdata/app:/config\nmein_vol:/data'} />
      </div>
      <NetworksPicker networks={extraNets} onChange={setExtraNets} />
    </Modal>
  );
}

export function ContainerDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [container, setContainer] = useState<Container | null>(null);
  const [inspect, setInspect] = useState<ContainerInspect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Stats history
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramPercent, setRamPercent] = useState(0);
  const [ramUsed, setRamUsed] = useState(0);
  const [ramLimit, setRamLimit] = useState(0);

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);
  // logSince: unix timestamp (seconds) – nur gesetzt wenn "Leeren" geklickt; wird beim Navigieren zurückgesetzt
  const [logSince, setLogSince] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);

  // Actions
  const [actionLoading, setActionLoading] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!id) return;
    try {
      const [listRes, inspectRes] = await Promise.all([
        api.containers.list(),
        api.containers.get(id) as Promise<{ container: ContainerInspect }>,
      ]);
      const found = listRes.containers.find((c) => c.id === id || c.shortId === id);
      setContainer(found ?? null);
      setInspect(inspectRes.container);
      setError('');
    } catch {
      setError('Container nicht gefunden');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial load
  useEffect(() => { void loadInfo(); }, [loadInfo]);

  // Stats polling
  useEffect(() => {
    if (!id) return;
    const poll = async () => {
      try {
        const s = await api.containers.stats(id);
        setCpuHistory((h) => [...h.slice(-(HISTORY_LEN - 1)), s.cpu]);
        setRamPercent(s.memory.percent);
        setRamUsed(s.memory.used);
        setRamLimit(s.memory.limit);
      } catch { /* container may be stopped */ }
    };
    void poll();
    const t = setInterval(poll, STATS_INTERVAL_MS);
    return () => clearInterval(t);
  }, [id]);

  // Logs: SSE stream (200 tail + live follow, or since=<ts> after clear)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const connect = async () => {
      try {
        const token = localStorage.getItem('token');
        const url = logSince
          ? `/api/containers/${id}/logs/stream?since=${logSince}`
          : `/api/containers/${id}/logs/stream`;
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || !response.body) { if (!cancelled) setLogLoading(false); return; }
        if (!cancelled) setLogLoading(false);

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const line = part.slice(6).trim();
              if (line) setLogs((prev) => [...prev.slice(-500), line]);
            }
          }
        }
      } catch { if (!cancelled) setLogLoading(false); }
    };

    void connect();
    return () => { cancelled = true; reader?.cancel().catch(() => {}); };
  }, [id, logSince]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const action = async (act: string, fn: () => Promise<unknown>) => {
    setActionLoading(act);
    try { await fn(); await loadInfo(); } catch { /* */ }
    finally { setActionLoading(''); }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try { await api.containers.remove(id); navigate('/containers'); }
    catch { setDeleting(false); setDeleteOpen(false); }
  };

  if (loading) return (
    <>
      <Topbar title={t('nav.containers')} />
      <main className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </main>
    </>
  );

  if (error || !container) return (
    <>
      <Topbar title={t('nav.containers')} />
      <main className="page">
        <div className="empty-state"><div className="empty-state__title">{error || t('page.notFound')}</div>
          <Link to="/containers" className="btn btn--primary btn--md" style={{ marginTop: 16 }}>{t('page.back')}</Link></div>
      </main>
    </>
  );

  const isRunning = container.state === 'running';
  const portLinks = Object.entries(inspect?.NetworkSettings.Ports ?? {}).flatMap(([key, bindings]) =>
    (bindings ?? []).filter((b) => b.HostPort).map((b) => {
      const ip = (!b.HostIp || b.HostIp === '0.0.0.0') ? window.location.hostname : b.HostIp;
      return {
        display: `${b.HostPort}:${key.split('/')[0]}`,
        proto: key.split('/')[1] ?? 'tcp',
        url: `http://${ip}:${b.HostPort}`,
      };
    })
  );
  const envVars = (inspect?.Config.Env ?? []).filter((e) => !e.startsWith('PATH=') && !e.startsWith('HOME='));
  const binds = inspect?.HostConfig.Binds ?? [];
  const restartPolicy = inspect?.HostConfig.RestartPolicy?.Name ?? 'no';

  return (
    <>
      <Topbar
        title={container.name}
        subtitle={container.image}
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Link to="/containers" className="btn btn--ghost btn--sm" style={{ gap: 4 }}>
              <ArrowLeft size={13} /> Zurück
            </Link>
            {isRunning ? (
              <>
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => setExecOpen(true)} title={tt('Konsole im Container öffnen')}>
                  <SquareTerminal size={12} /> Konsole
                </button>
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => action('restart', () => api.containers.restart(container.id))}>
                  {actionLoading === 'restart' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={12} />}
                  Neustart
                </button>
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => action('stop', () => api.containers.stop(container.id))}>
                  {actionLoading === 'stop' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Square size={12} />}
                  Stopp
                </button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" disabled={!!actionLoading} onClick={() => action('start', () => api.containers.start(container.id))}>
                {actionLoading === 'start' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
                Starten
              </button>
            )}
            <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => setEditOpen(true)} title={tt('Konfiguration ändern')}>
              <Pencil size={12} /> Bearbeiten
            </button>
            <button className="btn btn--danger btn--sm" disabled={!!actionLoading} onClick={() => setDeleteOpen(true)}>
              <Trash2 size={12} /> Löschen
            </button>
            <button className="icon-btn" onClick={loadInfo} title={tt('Aktualisieren')}>
              <RefreshCw size={14} />
            </button>
          </div>
        }
      />

      <main className="page">
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {stateBadge(container.state)}
          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{germanStatus(container.status)}</span>
          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>ID: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{container.shortId}</code></span>
          {inspect?.State.Pid ? <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>PID: {inspect.State.Pid}</span> : null}
          {restartPolicy !== 'no' && <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>Neustart: {germanRestart(restartPolicy)}</span>}
        </div>

        {/* Stats cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          {/* CPU */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">CPU</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                {cpuHistory.length ? `${cpuHistory[cpuHistory.length - 1].toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="card-body" style={{ padding: '10px 18px 14px' }}>
              <Sparkline data={cpuHistory} color="var(--color-accent)" height={64} />
            </div>
          </div>

          {/* RAM */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">RAM</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: ramPercent > 85 ? 'var(--color-error)' : ramPercent > 65 ? 'var(--color-warning)' : 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                {ramLimit > 0 ? `${ramPercent.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 12, color: 'var(--color-subtle)', marginBottom: 8 }}>
                {ramLimit > 0 ? `${formatBytes(ramUsed)} / ${formatBytes(ramLimit)}` : 'Kein Limit'}
              </div>
              <div className="stat-card__bar" style={{ height: 6 }}>
                <div className="stat-card__bar-fill" style={{ width: `${Math.min(ramPercent, 100)}%`, background: ramPercent > 85 ? 'var(--color-error)' : ramPercent > 65 ? 'var(--color-warning)' : 'var(--color-accent)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Container info */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setInfoOpen((o) => !o)}>
            <span className="card-title">{tt('Details')}</span>
            {infoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          {infoOpen && (
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>{tt('Image')}</div>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--color-muted)', wordBreak: 'break-all' }}>{inspect?.Config.Image}</code>
              </div>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>{tt('Erstellt')}</div>
                <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>{inspect ? new Date(inspect.Created).toLocaleString('de-DE') : '—'}</span>
              </div>
              {portLinks.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>{tt('Ports')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {portLinks.map((p) => (
                      <a key={p.display} href={p.url} target="_blank" rel="noreferrer"
                        className="port-chip"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title={`Öffnen: ${p.url}`}>
                        {p.display} <ExternalLink size={9} style={{ opacity: 0.7, flexShrink: 0 }} />
                      </a>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {portLinks.map((p) => (
                      <div key={p.display} style={{ fontSize: 11.5, color: 'var(--color-subtle)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-faint)' }}>
                          {p.proto.toUpperCase()}{' '}
                        </span>
                        <a href={p.url} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--color-accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                          {p.url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {binds.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>{tt('Volumes')}</div>
                  {binds.map((b) => (
                    <div key={b} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted)', padding: '3px 0', borderBottom: '1px solid var(--color-border)' }}>{b}</div>
                  ))}
                </div>
              )}
              {envVars.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Umgebungsvariablen ({envVars.length})</div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--color-surface-sunken)', borderRadius: 8, padding: '8px 10px' }}>
                    {envVars.map((e) => (
                      <div key={e} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--color-muted)', padding: '2px 0' }}>{e}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live logs */}
        <div className="card">
          <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setLogsOpen((o) => !o)}>
            <span className="card-title">{tt('Live-Logs')}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {logLoading && <span className="spinner" style={{ width: 12, height: 12 }} />}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--color-muted)' }}
                onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ width: 12, height: 12 }} />
                Auto-scroll
              </label>
              <button
                className="btn btn--ghost btn--sm"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title={tt('Logs ab jetzt leeren (ältere Einträge dauerhaft ausblenden)')}
                onClick={(e) => {
                  e.stopPropagation();
                  setLogSince(Math.floor(Date.now() / 1000));
                  setLogs([]);
                }}
              >
                {tt('Leeren')}
              </button>
              {logsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
          </div>
          {logsOpen && (
            <div style={{ padding: '0 16px 16px' }}>
              <div
                className="log-viewer"
                style={{ height: 380 }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  setAutoScroll(atBottom);
                }}
              >
                {logs.length === 0 ? (
                  <span style={{ color: 'var(--color-faint)' }}>{tt('Keine Logs verfügbar')}</span>
                ) : (
                  logs.map((line, i) => <div key={i}>{line}</div>)
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </main>

      <ConfirmModal
        open={deleteOpen}
        title={`Container löschen`}
        message={`Soll "${container.name}" wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.`}
        confirmLabel="Löschen"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      {execOpen && (
        <ContainerTerminal id={container.id} name={container.name} onClose={() => setExecOpen(false)} />
      )}

      {editOpen && (
        <EditModal
          container={container}
          inspect={inspect}
          onClose={() => setEditOpen(false)}
          onDone={(newId) => {
            setEditOpen(false);
            // Neue Container-ID → auf die neue Detailseite wechseln
            if (newId && newId !== container.id) navigate(`/containers/${newId}`, { replace: true });
            else void loadInfo();
          }}
        />
      )}
    </>
  );
}
