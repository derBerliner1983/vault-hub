import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Server, Box, Cable, ShieldCheck, ShieldX, Activity, MonitorPlay, Router, Monitor, HardDrive, Plus, Trash2, X } from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { tt } from '../lib/i18n';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import type { DockerNetwork, Container } from '../lib/types';

// Selbst angelegte Geräte (Router/Fritzbox, PC, NAS …), pro Benutzer gespeichert.
interface MapDevice { id: string; name: string; type: 'router' | 'pc' | 'nas' | 'server'; ip?: string }
const DEV_META: Record<MapDevice['type'], { label: string; Icon: React.ElementType }> = {
  router: { label: tt('Router/Gateway'), Icon: Router },
  pc:     { label: 'PC', Icon: Monitor },
  nas:    { label: 'NAS', Icon: HardDrive },
  server: { label: tt('Server'), Icon: Server },
};

// ── Datenaufbereitung ────────────────────────────────────────────────────────────
function isRealIp(ip: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.') && ip !== '0.0.0.0';
}
function lanSubnetOf(ip?: string): string | undefined {
  if (!ip || !isRealIp(ip)) return undefined;
  const p = ip.split('.'); p[3] = '0'; return p.join('.') + '/24';
}

type NodeKind = 'internet' | 'tunnel' | 'host' | 'docker' | 'vm' | 'router' | 'pc' | 'nas' | 'server';
interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  ip?: string;
  ports?: string[];      // veröffentlichte Ports (Host)
  reachIp?: string;      // Adresse, unter der der Dienst erreichbar ist
  x: number; y: number;
}

const KIND_META: Record<NodeKind, { color: string; Icon: React.ElementType }> = {
  internet: { color: 'var(--color-warning)', Icon: Globe },
  tunnel:   { color: '#38bdf8', Icon: Cable },
  host:     { color: 'var(--color-success)', Icon: Server },
  docker:   { color: 'var(--color-accent)', Icon: Box },
  vm:       { color: '#c084fc', Icon: MonitorPlay },
  router:   { color: '#f59e0b', Icon: Router },
  pc:       { color: '#94a3b8', Icon: Monitor },
  nas:      { color: '#94a3b8', Icon: HardDrive },
  server:   { color: '#94a3b8', Icon: Server },
};

type Reach = Record<string, { open: number[]; scanning: boolean; checked: boolean }>;

/**
 * Live-Netzwerkkarte (parallel zum Firewall-Studio): zeigt Internet → Tunnel/VPS →
 * Host → Docker-Container als Topologie, prüft live welche Ports erreichbar sind
 * (grün = offen, rot = geblockt) und erlaubt Firewall-Aktionen direkt am Knoten.
 */
export function NetworkMap({ networks, containers }: { networks: DockerNetwork[]; containers: Container[] }) {
  const [reach, setReach] = useState<Reach>({});
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [dName, setDName] = useState('');
  const [dType, setDType] = useState<MapDevice['type']>('router');
  const [dIp, setDIp] = useState('');
  const [hostIp, setHostIp] = useState('');
  // Objekte frei verschieben (Positionen pro Benutzer gespeichert)
  const canvasRef = useRef<HTMLDivElement>(null);
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ id: string; cl: number; ct: number; dx: number; dy: number; moved: boolean } | null>(null);
  const wasDragging = useRef(false);

  useEffect(() => {
    api.networks.interfaces().then((r) => {
      const lan = (r.interfaces || []).map((i) => i.ip4).find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(ip || ''));
      if (lan) setHostIp(lan);
    }).catch(() => {});
  }, []);

  // Host-LAN-IP + veröffentlichte Ports je Container aus den Port-Mappings ableiten
  const { hostLanIp: hostLanIpDerived, pubByName, pubAddrByName } = useMemo(() => {
    const pub = new Map<string, string[]>();
    const pubAddr = new Map<string, { ip: string; port: string }[]>();
    let host: string | undefined;
    for (const c of containers) {
      const addrs: { ip: string; port: string }[] = [];
      for (const p of (c.ports || [])) {
        if (!p.includes('->')) continue;
        const left = p.split('->')[0];
        const port = left.split(':').pop() || '';
        const ip = left.slice(0, left.lastIndexOf(':'));
        if (!port) continue;
        addrs.push({ ip, port });
        if (isRealIp(ip) && !host) host = ip;
      }
      if (addrs.length) {
        pub.set(c.name, [...new Set(addrs.map((a) => a.port))]);
        pubAddr.set(c.name, addrs);
      }
    }
    return { hostLanIp: host, pubByName: pub, pubAddrByName: pubAddr };
  }, [containers]);
  const hostLanIp = hostLanIpDerived || hostIp || undefined;

  const ipByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of networks) for (const c of n.containers) if (c.ipv4 && !m.has(c.name)) m.set(c.name, c.ipv4);
    return m;
  }, [networks]);

  const tunnel = containers.find((c) => /newt|pangolin|wireguard|tailscale|wg-easy|zerotier/i.test(`${c.name} ${c.image || ''}`));
  const tunnelName = tunnel?.name;
  // Container ohne den Tunnel-Container (der wird separat als Tunnel-Knoten gezeigt → nicht doppelt)
  const dockerNames = useMemo(
    () => [...new Set(networks.flatMap((n) => n.name === 'none' ? [] : n.containers.map((c) => c.name)))].filter((n) => n !== tunnelName),
    [networks, tunnelName],
  );
  const reachOf = (name: string): string | undefined => (pubAddrByName.get(name)?.find((a) => isRealIp(a.ip))?.ip) || hostLanIp;

  // Selbst angelegte Geräte (Fritzbox/Router, PC, NAS …)
  const { prefs, setPref } = usePrefs();
  const devices = (prefs.netMapDevices as MapDevice[] | undefined) || [];
  const addDevice = (d: MapDevice) => setPref('netMapDevices', [...devices, d]);
  const removeDevice = (id: string) => { setPref('netMapDevices', devices.filter((d) => d.id !== id)); setSel((s) => s === `dev:${id}` ? null : s); };
  const savedPos = (prefs.netMapPos as Record<string, { x: number; y: number }> | undefined) || {};
  const posOf = (id: string) => livePos[id] || savedPos[id];

  // ── Verschieben (Drag) ──
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current; if (!d) return;
      d.moved = true; wasDragging.current = true;
      setLivePos((l) => ({ ...l, [d.id]: { x: Math.max(24, (e.clientX - d.cl) - d.dx), y: Math.max(24, (e.clientY - d.ct) - d.dy) } }));
    };
    const up = () => {
      const d = drag.current;
      if (d && d.moved) setLivePos((l) => { const p = l[d.id]; if (p) setPref('netMapPos', { ...savedPos, [d.id]: p }); return l; });
      drag.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [savedPos, setPref]);

  const onNodeDown = (e: React.MouseEvent, id: string, cx: number, cy: number) => {
    const c = canvasRef.current?.getBoundingClientRect(); if (!c) return;
    wasDragging.current = false;
    drag.current = { id, cl: c.left, ct: c.top, dx: (e.clientX - c.left) - cx, dy: (e.clientY - c.top) - cy, moved: false };
  };

  // ── Layout (Ebenen: Internet → Tunnel/Host → Container → eigene Geräte) ──
  const cols = Math.max(dockerNames.length, 1);
  const W = Math.max(880, cols * 190 + 120, devices.length * 190 + 120);
  const yContainers = 340;
  const yDevices = 480;
  const H = devices.length ? 560 : 420;

  const nodes: MapNode[] = [];
  nodes.push({ id: 'internet', kind: 'internet', label: tt('Internet'), x: W / 2, y: 50 });
  if (tunnel) nodes.push({ id: 'tunnel', kind: 'tunnel', label: tunnel.name, sub: tt('Tunnel aktiv'), ip: ipByName.get(tunnel.name), x: W / 2 - 250, y: 190 });
  nodes.push({ id: 'host', kind: 'host', label: 'Host', sub: tt('Server'), ip: hostLanIp, x: W / 2, y: 190 });
  dockerNames.forEach((name, i) => {
    const x = cols === 1 ? W / 2 : 100 + (i * (W - 200)) / (cols - 1);
    nodes.push({ id: `docker:${name}`, kind: 'docker', label: name, ip: ipByName.get(name), ports: pubByName.get(name), reachIp: reachOf(name), x, y: yContainers });
  });
  devices.forEach((d, i) => {
    const x = devices.length === 1 ? W / 2 : 100 + (i * (W - 200)) / (devices.length - 1);
    nodes.push({ id: `dev:${d.id}`, kind: d.type, label: d.name, sub: DEV_META[d.type].label, ip: d.ip, x, y: yDevices });
  });
  // Gespeicherte/aktive Drag-Positionen überschreiben das Auto-Layout
  for (const n of nodes) { const p = posOf(n.id); if (p) { n.x = p.x; n.y = p.y; } }
  const Wc = Math.max(W, ...nodes.map((n) => n.x + 100));
  const Hc = Math.max(H, ...nodes.map((n) => n.y + 80));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Verbindungen (Quelle → Ziel, Beschriftung)
  const edges: { a: string; b: string; label?: string; dashed?: boolean }[] = [];
  if (tunnel) { edges.push({ a: 'internet', b: 'tunnel', label: tt('Tunnel'), dashed: true }); edges.push({ a: 'tunnel', b: 'host', dashed: true }); }
  edges.push({ a: 'internet', b: 'host', label: tt('direkt (nur mit Portfreigabe)') });
  dockerNames.forEach((name) => edges.push({ a: 'host', b: `docker:${name}` }));
  devices.forEach((d) => {
    if (d.type === 'router') { edges.push({ a: 'internet', b: `dev:${d.id}`, dashed: true }); edges.push({ a: `dev:${d.id}`, b: 'host' }); }
    else edges.push({ a: 'host', b: `dev:${d.id}` });
  });

  // ── Live-Erreichbarkeit ──
  const scanNode = async (name: string) => {
    const ports = (pubByName.get(name) || []).map(Number).filter((p) => p >= 1 && p <= 65535);
    const addr = reachOf(name);
    if (!ports.length || !addr) { setReach((r) => ({ ...r, [name]: { open: [], scanning: false, checked: true } })); return; }
    setReach((r) => ({ ...r, [name]: { open: r[name]?.open || [], scanning: true, checked: r[name]?.checked || false } }));
    try {
      const res = await api.networks.scan(addr, ports);
      setReach((r) => ({ ...r, [name]: { open: (res.open || []).sort((a, b) => a - b), scanning: false, checked: true } }));
    } catch {
      setReach((r) => ({ ...r, [name]: { open: [], scanning: false, checked: true } }));
    }
  };
  const scanAll = async () => { for (const name of dockerNames) await scanNode(name); };

  const nodeColor = (n: MapNode): string => {
    if (n.kind !== 'docker') return KIND_META[n.kind].color;
    const r = reach[n.label];
    if (!r || !r.checked) return KIND_META.docker.color;
    if (!(n.ports && n.ports.length)) return 'var(--color-faint)';
    return r.open.length ? 'var(--color-success)' : 'var(--color-error)';
  };

  // ── Firewall-Aktionen direkt am Knoten ──
  const allowLan = async (port: string) => {
    const sub = lanSubnetOf(hostLanIp);
    setBusy(port + 'a'); setMsg('');
    try { await api.firewall.add({ action: 'allow', port, proto: 'tcp', direction: 'in', from: sub, comment: 'Karte: LAN' }); setMsg(tt('Port {p} fürs LAN freigegeben.', { p: port })); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(''); }
  };
  const denyPort = async (port: string) => {
    setBusy(port + 'd'); setMsg('');
    try { await api.firewall.add({ action: 'deny', port, proto: 'tcp', direction: 'in', comment: 'Karte: gesperrt' }); setMsg(tt('Port {p} gesperrt.', { p: port })); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(''); }
  };

  const selNode = sel ? nodeById.get(sel) : null;

  return (
    <Panel
      title={tt('Live-Netzwerkkarte')}
      icon={<Activity size={15} />}
      subtitle={tt('Wer erreicht wen · welcher Port offen ist · direkt Firewall schalten')}
      storageKey="net-map"
      actions={
        <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn--outline btn--sm" onClick={() => setShowAdd((v) => !v)}><Plus size={12} /> {tt('Gerät')}</button>
          <button className="btn btn--primary btn--sm" onClick={() => void scanAll()}><Activity size={12} /> {tt('Live prüfen')}</button>
        </div>
      }
    >
      {showAdd && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 12px', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <input className="input input--rect" style={{ width: 170 }} placeholder={tt('Name (z.B. FRITZ!Box)')} value={dName} onChange={(e) => setDName(e.target.value)} />
          <select className="input input--rect" style={{ width: 150, cursor: 'pointer' }} value={dType} onChange={(e) => setDType(e.target.value as MapDevice['type'])}>
            <option value="router">{tt('Router/Gateway')}</option>
            <option value="pc">PC</option>
            <option value="nas">NAS</option>
            <option value="server">{tt('Server')}</option>
          </select>
          <input className="input input--rect" style={{ width: 150, fontFamily: 'var(--font-mono)' }} placeholder={tt('IP (optional)')} value={dIp} onChange={(e) => setDIp(e.target.value)} />
          <button className="btn btn--primary btn--sm" disabled={!dName.trim()} onClick={() => { addDevice({ id: 'd' + Date.now(), name: dName.trim(), type: dType, ip: dIp.trim() || undefined }); setDName(''); setDIp(''); setShowAdd(false); }}>{tt('Hinzufügen')}</button>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setShowAdd(false)}><X size={13} /></button>
        </div>
      )}
      <div style={{ overflow: 'auto', paddingBottom: 6, maxHeight: '70vh' }}>
        <div ref={canvasRef} style={{ position: 'relative', width: Wc, height: Hc, margin: '4px auto', minWidth: Wc }}>
          {/* Verbindungslinien */}
          <svg width={Wc} height={Hc} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {edges.map((e, i) => {
              const a = nodeById.get(e.a), b = nodeById.get(e.b);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-border)" strokeWidth={2} strokeDasharray={e.dashed ? '6 5' : undefined} />
                  {e.label && (
                    <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="var(--color-faint)">{e.label}</text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Knoten */}
          {nodes.map((n) => {
            const meta = KIND_META[n.kind];
            const color = nodeColor(n);
            const r = n.kind === 'docker' ? reach[n.label] : undefined;
            return (
              <div
                key={n.id}
                onMouseDown={(e) => onNodeDown(e, n.id, n.x, n.y)}
                onClick={() => { if (wasDragging.current) { wasDragging.current = false; return; } setSel(n.id === sel ? null : n.id); }}
                style={{
                  position: 'absolute', left: n.x, top: n.y, transform: 'translate(-50%,-50%)',
                  width: 156, cursor: 'grab', userSelect: 'none',
                  background: 'var(--color-surface)', border: `1.5px solid ${sel === n.id ? 'var(--color-accent)' : color}`,
                  borderRadius: 10, padding: '8px 10px', boxShadow: sel === n.id ? '0 0 0 3px var(--color-accent-soft)' : '0 2px 8px rgba(0,0,0,.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <meta.Icon size={16} color={color} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                  {r?.scanning && <span className="spinner" style={{ width: 10, height: 10, marginLeft: 'auto' }} />}
                </div>
                {n.ip && <div style={{ fontSize: 10.5, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{n.ip}</div>}
                {n.sub && !n.ip && <div style={{ fontSize: 10.5, color: 'var(--color-muted)', marginTop: 2 }}>{n.sub}</div>}
                {n.kind === 'docker' && n.ports && n.ports.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                    {n.ports.slice(0, 6).map((p) => {
                      const open = r?.checked ? r.open.includes(Number(p)) : null;
                      const c = open === null ? 'var(--color-faint)' : open ? 'var(--color-success)' : 'var(--color-error)';
                      return <span key={p} style={{ fontSize: 9.5, fontWeight: 700, color: c, border: `1px solid ${c}`, borderRadius: 3, padding: '0 4px' }}>{p}</span>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legende */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
        <span><span style={{ color: 'var(--color-success)' }}>■</span> {tt('Port offen/erreichbar')}</span>
        <span><span style={{ color: 'var(--color-error)' }}>■</span> {tt('geblockt')}</span>
        <span><span style={{ color: 'var(--color-faint)' }}>■</span> {tt('nicht geprüft / kein veröffentlichter Port')}</span>
      </div>

      {/* Inspector des gewählten Knotens */}
      {selNode && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {(() => { const M = KIND_META[selNode.kind]; return <M.Icon size={16} color={M.color} />; })()}
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{selNode.label}</span>
            {selNode.ip && <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{selNode.ip}</span>}
            {selNode.id.startsWith('dev:') && (
              <button className="btn btn--ghost btn--icon btn--sm" style={{ marginLeft: 'auto', color: 'var(--color-error)' }} title={tt('Gerät entfernen')} onClick={() => removeDevice(selNode.id.slice('dev:'.length))}><Trash2 size={13} /></button>
            )}
          </div>

          {selNode.kind === 'docker' && selNode.ports && selNode.ports.length > 0 ? (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginBottom: 8 }}>
                {tt('Erreichbar über')} <b style={{ fontFamily: 'var(--font-mono)' }}>{selNode.reachIp || '—'}</b>. {tt('Firewall direkt schalten:')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selNode.ports.map((p) => {
                  const r = reach[selNode.label];
                  const open = r?.checked ? r.open.includes(Number(p)) : null;
                  return (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', minWidth: 54 }}>Port {p}</span>
                      <span style={{ fontSize: 11, color: open === null ? 'var(--color-faint)' : open ? 'var(--color-success)' : 'var(--color-error)', minWidth: 80 }}>
                        {open === null ? tt('unbekannt') : open ? tt('offen') : tt('geblockt')}
                      </span>
                      <button className="btn btn--outline btn--sm" disabled={busy === p + 'a'} onClick={() => void allowLan(p)} style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
                        <ShieldCheck size={12} /> {tt('LAN freigeben')}
                      </button>
                      <button className="btn btn--outline btn--sm" disabled={busy === p + 'd'} onClick={() => void denyPort(p)} style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)' }}>
                        <ShieldX size={12} /> {tt('sperren')}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 8 }}>{tt('Regeln greifen nur bei aktiver Firewall. „LAN freigeben" erlaubt nur das lokale Netz, niemals das Internet.')}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              {selNode.kind === 'docker' ? tt('Dieser Container veröffentlicht keine Ports zum Host.') : tt('Keine direkt schaltbaren Ports an diesem Knoten.')}
            </div>
          )}
          {msg && <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 8 }}>{msg}</div>}
        </div>
      )}
    </Panel>
  );
}
