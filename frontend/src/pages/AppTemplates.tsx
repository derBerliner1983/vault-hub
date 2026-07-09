import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, Download, CheckCircle2, Star, ChevronLeft, ChevronRight, Plus, Trash2, Eye, EyeOff, RefreshCw, Loader, Network, ChevronDown } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import type { StoreItem, StoreSearchResult, DockerNetwork, HostInterface } from '../lib/types';

// ── App icon with graceful fallback ─────────────────────────────────────────

function AppIcon({ src, name, size = 48 }: { src: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 10, flexShrink: 0,
        background: 'var(--color-accent-soft)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.4, color: 'var(--color-accent)',
      }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src} alt={name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 10, objectFit: 'contain', background: '#fff', padding: 4, flexShrink: 0 }}
    />
  );
}

// ── Row-editors used inside the install modal ────────────────────────────────

interface PortRow { id: number; container: number; host: number; proto: 'tcp' | 'udp' }
interface VolRow  { id: number; name: string; path: string }
interface EnvRow  { id: number; key: string; label: string; value: string; secret: boolean; required: boolean }

let _uid = 1;
const uid = () => _uid++;

function PortsEditor({ rows, onChange }: { rows: PortRow[]; onChange: (r: PortRow[]) => void }) {
  const add = () => onChange([...rows, { id: uid(), container: 80, host: 8080, proto: 'tcp' }]);
  const upd = (id: number, patch: Partial<PortRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>{tt('Ports')}</label>
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> {tt('Port')}</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>{tt('Keine Ports konfiguriert.')}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
          <input className="input input--rect" type="number" value={r.host} min={1} max={65535} style={{ width: 80 }}
            onChange={(e) => upd(r.id, { host: parseInt(e.target.value) || r.host })} title={tt('Host-Port')} />
          <span className="text-muted" style={{ fontSize: 12, flexShrink: 0 }}>→</span>
          <input className="input input--rect" type="number" value={r.container} min={1} max={65535} style={{ width: 80 }}
            onChange={(e) => upd(r.id, { container: parseInt(e.target.value) || r.container })} title={tt('Container-Port')} />
          <select className="input input--rect" value={r.proto} style={{ width: 70 }}
            onChange={(e) => upd(r.id, { proto: e.target.value as 'tcp' | 'udp' })}>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function VolsEditor({ rows, onChange }: { rows: VolRow[]; onChange: (r: VolRow[]) => void }) {
  const add = () => onChange([...rows, { id: uid(), name: 'data', path: '/data' }]);
  const upd = (id: number, patch: Partial<VolRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>{tt('Volumes')}</label>
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> {tt('Volume')}</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>{tt('Keine Volumes konfiguriert.')}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
          <input className="input input--rect" value={r.name} placeholder={tt('vol-name')} style={{ flex: 1 }}
            onChange={(e) => upd(r.id, { name: e.target.value })} title={tt('Volume-Name (wird als Container-Name_vol-name angelegt)')} />
          <span className="text-muted" style={{ fontSize: 12, flexShrink: 0 }}>:</span>
          <input className="input input--rect" value={r.path} placeholder={tt('/data')} style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={(e) => upd(r.id, { path: e.target.value })} title={tt('Pfad im Container')} />
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function EnvEditor({ rows, onChange }: { rows: EnvRow[]; onChange: (r: EnvRow[]) => void }) {
  const [showSecrets, setShowSecrets] = useState(false);
  const add = () => onChange([...rows, { id: uid(), key: '', label: '', value: '', secret: false, required: false }]);
  const upd = (id: number, patch: Partial<EnvRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>{tt('Umgebungsvariablen')}</label>
        {rows.some((r) => r.secret) && (
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowSecrets(!showSecrets)} title={showSecrets ? 'Werte verbergen' : 'Werte anzeigen'}>
            {showSecrets ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> {tt('Variable')}</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>{tt('Keine Variablen konfiguriert.')}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input input--rect" value={r.key} placeholder={tt('VARIABLE_NAME')}
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              onChange={(e) => upd(r.id, { key: e.target.value.replace(/[^A-Z0-9_]/gi, '_').toUpperCase() })} />
            <input className="input input--rect" value={r.value} placeholder={r.label || 'Wert…'}
              type={r.secret && !showSecrets ? 'password' : 'text'} style={{ flex: 2 }}
              onChange={(e) => upd(r.id, { value: e.target.value })} />
            <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
          </div>
          {(r.label && r.label !== r.key) && (
            <div style={{ fontSize: 11, color: 'var(--color-faint)', marginLeft: 2, marginTop: 1 }}>
              {r.label}{r.required && <span style={{ color: 'var(--color-error)' }}> *</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Konfiguration eines neu anzulegenden Macvlan-Netzwerks
export interface NewNet { parent: string; subnet: string; gateway: string; vlan: string }
const CREATE = '__create__';

// ── Network/IP Section (optional, collapsed by default) ─────────────────────
function NetworkSection({
  networks, interfaces, networkMode, staticIp, newNet,
  onModeChange, onIpChange, onNewNetChange,
}: {
  networks: DockerNetwork[];
  interfaces: HostInterface[];
  networkMode: string;
  staticIp: string;
  newNet: NewNet;
  onModeChange: (m: string) => void;
  onIpChange: (ip: string) => void;
  onNewNetChange: (n: NewNet) => void;
}) {
  const [open, setOpen] = useState(false);

  // Named networks the user could connect to (macvlan, ipvlan, or custom bridge)
  const named = networks.filter((n) => !n.builtin);
  const selectedNet = named.find((n) => n.name === networkMode) ?? null;
  const creating = networkMode === CREATE;
  const active = networkMode && networkMode !== 'bridge';
  const ipValid = !staticIp || /^\d{1,3}(\.\d{1,3}){3}$/.test(staticIp);

  return (
    <div style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          color: active ? 'var(--color-accent)' : 'var(--color-muted)',
        }}
      >
        <Network size={13} />
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, textAlign: 'left' }}>
          Netzwerk / IP-Adresse
          {active && (
            <span style={{ fontWeight: 400, color: 'var(--color-accent)', marginLeft: 6, fontSize: 11 }}>
              {creating ? 'neues Macvlan' : networkMode}{staticIp ? ` · ${staticIp}` : ''}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-faint)' }}>optional</span>
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 10, lineHeight: 1.6 }}>
            Standard: Container nutzt das Docker-Bridge-Netzwerk und deine Port-Zuordnungen.
            Mit einem eigenen Macvlan-Netzwerk bekommt der Container eine <strong>{tt('eigene IP im Heimnetz')}</strong> —
            sinnvoll z. B. für AdGuard/Pi-hole (DNS Port 53 kein Konflikt), Home Assistant u. a.
          </div>

          <label className="form-label">{tt('Netzwerkmodus')}</label>
          <select
            className="input input--rect"
            style={{ width: '100%', marginBottom: 10 }}
            value={networkMode}
            onChange={(e) => { onModeChange(e.target.value); onIpChange(''); }}
          >
            <option value="bridge">Standard (bridge)</option>
            <option value="host">host (Ports teilen mit Host)</option>
            {named.map((n) => (
              <option key={n.id} value={n.name}>
                {n.name} [{n.driver}]{n.subnet ? ` · ${n.subnet}` : ''}
              </option>
            ))}
            <option value={CREATE}>＋ Neues Macvlan-Netzwerk anlegen (eigene IP)…</option>
          </select>

          {/* Neues Macvlan-Netzwerk direkt hier anlegen */}
          {creating && (
            <div style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 8, lineHeight: 1.6 }}>
                Wird beim Installieren automatisch angelegt. Der Container erhält dann eine eigene IP im Heimnetz.
              </div>
              <label className="form-label">Netzwerk-Interface (Parent)</label>
              <select
                className="input input--rect" style={{ width: '100%', marginBottom: 8 }}
                value={newNet.parent}
                onChange={(e) => onNewNetChange({ ...newNet, parent: e.target.value })}
              >
                <option value="">{tt('— Interface wählen —')}</option>
                {interfaces.map((i) => (
                  <option key={i.iface} value={i.iface}>{i.iface}{i.ip4 ? ` (${i.ip4})` : ''}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 2 }}>
                  <label className="form-label">Subnetz (CIDR)</label>
                  <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    placeholder={tt('z.B. 192.168.1.0/24')} value={newNet.subnet}
                    onChange={(e) => onNewNetChange({ ...newNet, subnet: e.target.value.trim() })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">VLAN (optional)</label>
                  <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    placeholder={tt('z.B. 20')} value={newNet.vlan}
                    onChange={(e) => onNewNetChange({ ...newNet, vlan: e.target.value.replace(/[^0-9]/g, '') })} />
                </div>
              </div>
              <label className="form-label">{tt('Gateway')}</label>
              <input className="input input--rect" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                placeholder={tt('z.B. 192.168.1.1')} value={newNet.gateway}
                onChange={(e) => onNewNetChange({ ...newNet, gateway: e.target.value.trim() })} />
            </div>
          )}

          {(selectedNet || creating) && (
            <>
              <label className="form-label">
                Statische IP-Adresse
                {selectedNet?.subnet ? ` (Subnetz: ${selectedNet.subnet})` : creating && newNet.subnet ? ` (Subnetz: ${newNet.subnet})` : ''}
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input input--rect"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1 }}
                  placeholder={
                    selectedNet?.gateway ? `z.B. ${selectedNet.gateway.replace(/\.\d+$/, '.200')}`
                      : newNet.gateway ? `z.B. ${newNet.gateway.replace(/\.\d+$/, '.200')}` : '192.168.x.y'
                  }
                  value={staticIp}
                  onChange={(e) => onIpChange(e.target.value.trim())}
                />
                {!ipValid && (
                  <span style={{ fontSize: 11, color: 'var(--color-error)', flexShrink: 0 }}>{tt('Ungültige IP')}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 5 }}>
                Leer lassen = automatische IP. Port-Zuordnungen entfallen bei eigener IP (unnötig).
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Install Modal ─────────────────────────────────────────────────────────────

function InstallModal({ item, onClose, onDone }: { item: StoreItem | null; onClose: () => void; onDone: () => void }) {
  const [cname, setCname] = useState('');
  const [restart, setRestart] = useState('unless-stopped');
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [vols, setVols] = useState<VolRow[]>([]);
  const [envs, setEnvs] = useState<EnvRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [networkMode, setNetworkMode] = useState('bridge');
  const [staticIp, setStaticIp] = useState('');
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [interfaces, setInterfaces] = useState<HostInterface[]>([]);
  const [newNet, setNewNet] = useState<NewNet>({ parent: '', subnet: '', gateway: '', vlan: '' });
  // Vom Backend vorgeschlagene freie Host-Ports bei Konflikt
  const [portFix, setPortFix] = useState<{ host: number; proto: string; suggestedHost: number }[]>([]);

  useEffect(() => {
    if (!item) return;
    setCname(item.id.slice(0, 40));
    setRestart(item.restart || 'unless-stopped');
    setPorts(item.ports.map((p) => ({ id: uid(), ...p })));
    setVols(item.volumes.map((v) => ({ id: uid(), ...v })));
    setEnvs(item.env.map((e) => ({ id: uid(), key: e.key, label: e.label, value: e.default, secret: e.secret, required: e.required })));
    setNetworkMode('bridge'); setStaticIp('');
    setNewNet({ parent: '', subnet: '', gateway: '', vlan: '' });
    setError(''); setDone(''); setPortFix([]);
    // Load Docker networks + host interfaces for the network section
    api.networks.list().then((r) => setNetworks(r.networks)).catch(() => setNetworks([]));
    api.networks.interfaces().then((r) => setInterfaces(r.interfaces)).catch(() => setInterfaces([]));
  }, [item]);

  if (!item) return null;

  const install = async () => {
    // Validate required env
    const missing = envs.filter((e) => e.required && !e.value.trim());
    if (missing.length) { setError(`Pflichtfeld fehlt: ${missing.map((e) => e.label || e.key).join(', ')}`); return; }
    // IP-Format prüfen, falls eine eigene IP gesetzt wurde
    if (staticIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(staticIp)) { setError('Ungültige IP-Adresse.'); return; }
    setBusy(true); setError(''); setPortFix([]);
    try {
      // Soll ein neues Macvlan-Netzwerk angelegt werden? Dann zuerst erstellen.
      let effectiveMode = networkMode;
      if (networkMode === CREATE) {
        if (!newNet.parent) { setError('Bitte ein Netzwerk-Interface (Parent) für das Macvlan-Netzwerk wählen.'); setBusy(false); return; }
        if (!newNet.subnet) { setError('Bitte ein Subnetz (CIDR) für das Macvlan-Netzwerk angeben.'); setBusy(false); return; }
        const netName = `mv-${(cname || item.id).slice(0, 24)}`.replace(/[^a-zA-Z0-9_.-]/g, '');
        try {
          await api.networks.create({
            name: netName, driver: 'macvlan',
            parent: newNet.parent, subnet: newNet.subnet,
            gateway: newNet.gateway || undefined, vlan: newNet.vlan || undefined,
          });
        } catch (e) {
          // „already exists" tolerieren – dann einfach das vorhandene nutzen
          const msg = (e as { raw?: string }).raw ?? (e instanceof Error ? e.message : '');
          if (!/exists|in use/i.test(msg)) { setError(`Netzwerk konnte nicht angelegt werden: ${msg}`); setBusy(false); return; }
        }
        effectiveMode = netName;
      }
      const envMap: Record<string, string> = {};
      for (const e of envs) if (e.key) envMap[e.key] = e.value;
      const res = await api.store.install({
        name: cname || item.id,
        image: item.image,
        ports: ports.map((p) => ({ container: p.container, host: p.host, proto: p.proto })),
        volumes: vols.map((v) => ({ name: v.name, path: v.path })),
        env: envMap,
        restart,
        templateId: item.source === 'unraid' ? item.id : undefined,
        category: item.category,
        icon: item.icon || undefined,
        networkMode: effectiveMode !== 'bridge' ? effectiveMode : undefined,
        staticIp: staticIp || undefined,
      });
      setDone(`„${res.name}" wurde installiert und gestartet.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation fehlgeschlagen');
      // Port-Konflikt? Dann die vorgeschlagenen freien Ports zum Übernehmen anbieten.
      const data = (err as { data?: { conflicts?: { host: number; proto: string; suggestedHost: number }[] } }).data;
      if (data?.conflicts?.length) {
        setPortFix(data.conflicts.map((c) => ({ host: c.host, proto: c.proto, suggestedHost: c.suggestedHost })));
      }
    } finally { setBusy(false); }
  };

  // Vorgeschlagene freie Ports in die Port-Zeilen übernehmen
  const applyPortFix = () => {
    setPorts((rows) => rows.map((r) => {
      const fix = portFix.find((f) => f.host === r.host && f.proto === r.proto);
      return fix ? { ...r, host: fix.suggestedHost } : r;
    }));
    setPortFix([]); setError('');
  };

  return (
    <Modal
      open={!!item}
      title={`${item.name} installieren`}
      onClose={onClose}
      width={680}
      footer={done ? (
        <button className="btn btn--primary btn--sm" onClick={onClose}>{tt('Schließen')}</button>
      ) : (
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={install} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} Installieren
          </button>
        </>
      )}
    >
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0' }}>
          <CheckCircle2 size={40} style={{ color: 'var(--color-success)' }} />
          <div style={{ fontWeight: 600 }}>{done}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-muted)', textAlign: 'center' }}>{tt('Du findest den Container unter „Container".')}</div>
        </div>
      ) : (
        <div style={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 4 }}>
          {error && <div className="login-error" style={{ marginBottom: portFix.length ? 6 : 10 }}>{error}</div>}
          {portFix.length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn--primary btn--sm" onClick={applyPortFix}>
                Freie Ports übernehmen ({portFix.map((f) => `${f.host}→${f.suggestedHost}`).join(', ')})
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
                danach erneut „Installieren"
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14 }}>
            <AppIcon src={item.icon} name={item.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{item.name}</div>
              <div className="dtable__mono text-muted" style={{ fontSize: 11 }}>{item.image}</div>
              {item.description && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {item.description}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 2 }}>
              <label className="form-label">{tt('Container-Name')}</label>
              <input className="input input--rect" value={cname} onChange={(e) => setCname(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '_'))}
                style={{ fontFamily: 'var(--font-mono)', width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">{tt('Restart-Policy')}</label>
              <select className="input input--rect" value={restart} onChange={(e) => setRestart(e.target.value)} style={{ width: '100%' }}>
                <option value="unless-stopped">unless-stopped</option>
                <option value="always">always</option>
                <option value="on-failure">on-failure</option>
                <option value="no">no</option>
              </select>
            </div>
          </div>

          <PortsEditor rows={ports} onChange={setPorts} />
          <VolsEditor rows={vols} onChange={setVols} />
          <EnvEditor rows={envs} onChange={setEnvs} />
          <NetworkSection
            networks={networks}
            interfaces={interfaces}
            networkMode={networkMode}
            staticIp={staticIp}
            newNet={newNet}
            onModeChange={setNetworkMode}
            onIpChange={setStaticIp}
            onNewNetChange={setNewNet}
          />
        </div>
      )}
    </Modal>
  );
}

// ── App card ──────────────────────────────────────────────────────────────────

function AppCard({ item, onInstall }: { item: StoreItem; onInstall: (item: StoreItem) => void }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-body" style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <AppIcon src={item.icon} name={item.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
              <span className="badge badge--paused" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>{item.category}</span>
              {item.installed && (
                <span className="badge badge--running" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>
                  <CheckCircle2 size={9} /> installiert
                </span>
              )}
              {item.stars != null && item.stars > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--color-muted)' }}>
                  <Star size={10} /> {item.stars.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', minHeight: 32, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {item.description || <span className="text-faint">{tt('Keine Beschreibung')}</span>}
        </div>
        <div className="dtable__mono text-faint" style={{ fontSize: 10.5, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.image}</div>
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
        <button className="btn btn--primary btn--sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onInstall(item)}>
          <Download size={13} /> {item.installed ? 'Erneut installieren' : 'Installieren'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AppTemplates() {
  const t = useT();
  const [source, setSource] = useState<'unraid' | 'dockerhub'>('unraid');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<StoreSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StoreItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounce query input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQuery(query); setPage(1); }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const search = useCallback(async (q: string, src: 'unraid' | 'dockerhub', pg: number, cat: string) => {
    setLoading(true);
    try {
      const res = await api.store.search(q, src, pg, cat);
      setResult(res);
    } catch { /* keep last result */ }
    finally { setLoading(false); }
  }, []);

  // Run search whenever source/query/page/category changes
  useEffect(() => {
    void search(debouncedQuery, source, page, category);
  }, [search, debouncedQuery, source, page, category]);

  // Poll while Unraid feed is warming (result comes back with cached: false)
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (source === 'unraid' && result && !result.cached && result.warming !== false) {
      pollRef.current = setInterval(() => { void search(debouncedQuery, 'unraid', page, category); }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [search, source, result, debouncedQuery, page, category]);

  // Reset page when source/category changes
  const switchSource = (s: 'unraid' | 'dockerhub') => { setSource(s); setPage(1); setCategory(''); };
  const switchCategory = (c: string) => { setCategory(c); setPage(1); };

  const total   = result?.total ?? 0;
  const limit   = result?.limit ?? 24;
  const pages   = Math.max(1, Math.ceil(total / limit));
  const warming = source === 'unraid' && result?.cached === false;

  const categories = useMemo(() => result?.categories ?? [], [result?.categories]);

  const subtitle = warming
    ? 'Unraid Store wird geladen…'
    : result
      ? `${total.toLocaleString()} Apps${source === 'unraid' ? ' · Unraid Community' : ' · Docker Hub'}`
      : undefined;

  return (
    <>
      <Topbar
        title={t('nav.apps')}
        subtitle={subtitle}
        onRefresh={() => { void search(debouncedQuery, source, page, category); }}
        refreshing={loading}
        actions={
          source === 'unraid' && (
            <button className="btn btn--outline btn--sm" onClick={async () => { await api.store.warm(); setTimeout(() => void search(debouncedQuery, 'unraid', page, category), 500); }} title={tt('Feed neu laden')}>
              <RefreshCw size={13} /> Feed aktualisieren
            </button>
          )
        }
      />
      <main className="page">
        {/* Source toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="filter-tabs" style={{ margin: 0 }}>
            {(['unraid', 'dockerhub'] as const).map((s) => (
              <button key={s} className={`filter-tab${source === s ? ' filter-tab--active' : ''}`} onClick={() => switchSource(s)}>
                {s === 'unraid' ? 'Unraid Community Store' : 'Docker Hub'}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
            <input
              className="input input--rect"
              placeholder={source === 'dockerhub' ? 'Image suchen (mind. 2 Zeichen)…' : 'App-Store durchsuchen…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: 30 }}
            />
          </div>
        </div>

        {/* Category filter chips (Unraid only) */}
        {source === 'unraid' && categories.length > 0 && (
          <div className="filter-tabs" style={{ flexWrap: 'wrap', marginBottom: 14, gap: 4 }}>
            <button className={`filter-tab${!category ? ' filter-tab--active' : ''}`} onClick={() => switchCategory('')}>{tt('Alle')}</button>
            {categories.map((c) => (
              <button key={c} className={`filter-tab${category === c ? ' filter-tab--active' : ''}`} onClick={() => switchCategory(c)}>{c}</button>
            ))}
          </div>
        )}

        {/* Warming state */}
        {warming && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '60px 20px', color: 'var(--color-muted)' }}>
            <Loader size={36} style={{ animation: 'spin 1.2s linear infinite', color: 'var(--color-accent)' }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{tt('Unraid Community Store wird geladen…')}</div>
            <div style={{ fontSize: 12.5 }}>{tt('Das dauert beim ersten Mal 10–30 Sekunden.')}</div>
          </div>
        )}

        {/* Docker Hub: prompt if query too short */}
        {!warming && source === 'dockerhub' && query.trim().length < 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 20px', color: 'var(--color-muted)' }}>
            <Search size={40} strokeWidth={1} />
            <div style={{ fontSize: 13 }}>{tt('Suchbegriff eingeben, um Docker Hub zu durchsuchen.')}</div>
          </div>
        )}

        {/* Results grid */}
        {!warming && (source === 'dockerhub' ? query.trim().length >= 2 : true) && (
          <>
            {loading && !result?.results?.length ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <span className="spinner" style={{ width: 28, height: 28 }} />
              </div>
            ) : (result?.results?.length ?? 0) === 0 && !loading ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--color-muted)' }}>
                {query ? `Keine Ergebnisse für „${query}".` : 'Keine Apps gefunden.'}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                  {(result?.results ?? []).map((item) => (
                    <AppCard key={`${item.source}-${item.id}`} item={item} onInstall={setSelected} />
                  ))}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20 }}>
                    <button className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft size={13} /> Zurück
                    </button>
                    <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>Seite {page} / {pages} ({total.toLocaleString()} Apps)</span>
                    <button className="btn btn--outline btn--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                      Weiter <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <InstallModal item={selected} onClose={() => setSelected(null)} onDone={() => void search(debouncedQuery, source, page, category)} />
    </>
  );
}
