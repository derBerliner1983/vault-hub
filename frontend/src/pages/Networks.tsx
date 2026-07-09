import { useState, useEffect, useCallback, useRef } from 'react';
import { Network, Plus, Trash2, Shield, Link2, Unlink, Lock, Cable, MonitorPlay, Play, Square, Star, Link, Pencil, RefreshCw, X, Activity, Download, AlertTriangle, ShieldPlus, Server, Globe, Box, LayoutGrid, Table, Terminal, RotateCcw } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { portInfo } from '../lib/utils';
import { NetworkMap } from './NetworkMap';
import type { DockerNetwork, HostInterface, FirewallRule, FirewallDisabledRule, FirewallLogEntry, Container, VmNetwork, VM, ContainerNetworkEntry, VmIpEntry, NetscanJob } from '../lib/types';

function CreateNetModal({ open, onClose, onDone, interfaces }: { open: boolean; onClose: () => void; onDone: () => void; interfaces: HostInterface[] }) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [parent, setParent] = useState('');
  const [vlan, setVlan] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.networks.create({ name, driver, subnet: subnet || undefined, gateway: gateway || undefined, parent: parent || undefined, vlan: vlan || undefined, internal });
      setName(''); setSubnet(''); setGateway(''); setParent(''); setVlan(''); setInternal(false); setDriver('bridge');
      onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  const isVlan = driver === 'macvlan' || driver === 'ipvlan';

  return (
    <Modal open={open} title={tt('Neues Netzwerk')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">{tt('Name')}</label>
          <input className="input input--rect" placeholder={tt('dmz-netz')} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Treiber')}</label>
          <select className="input input--rect" value={driver} onChange={(e) => setDriver(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="bridge">bridge (Standard)</option>
            <option value="macvlan">macvlan (eigene IP im LAN)</option>
            <option value="ipvlan">ipvlan</option>
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Subnetz (optional)</label>
          <input className="input input--rect" placeholder="192.168.50.0/24" value={subnet} onChange={(e) => setSubnet(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
        <div className="form-group"><label className="form-label">Gateway (optional)</label>
          <input className="input input--rect" placeholder="192.168.50.1" value={gateway} onChange={(e) => setGateway(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
      </div>
      {isVlan && (
        <div className="form-row">
          <div className="form-group"><label className="form-label">{tt('Eltern-Schnittstelle')}</label>
            <select className="input input--rect" value={parent} onChange={(e) => setParent(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="">{tt('— wählen —')}</option>
              {interfaces.map((i) => <option key={i.iface} value={i.iface}>{i.iface} ({i.ip4 || 'keine IP'})</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder={tt('z.B. 100')} value={vlan} onChange={(e) => setVlan(e.target.value)} />
            <div className="form-hint">Erzeugt Tag {parent || 'ethX'}.{vlan || 'ID'}</div></div>
        </div>
      )}
      <label className="legend__item" style={{ cursor: 'pointer', marginTop: 4 }}>
        <Switch checked={internal} onChange={setInternal} />
        <span><Lock size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <b>Isoliert (internal)</b> — <span className="text-muted">{tt('kein Zugriff nach außen, sichert unsichere Container ab')}</span></span>
      </label>
    </Modal>
  );
}

function ConnectModal({ net, open, onClose, onDone, containers }: { net: DockerNetwork | null; open: boolean; onClose: () => void; onDone: () => void; containers: Container[] }) {
  const [container, setContainer] = useState('');
  const [ip, setIp] = useState('');
  const [aliases, setAliases] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (containers[0]) setContainer(containers[0].id); }, [containers, open]);

  const save = async () => {
    if (!net || !container) { setError('Container wählen'); return; }
    setLoading(true); setError('');
    try {
      await api.networks.connect(net.id, container, ip || undefined, aliases ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : undefined);
      setIp(''); setAliases(''); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={`Container verbinden → ${net?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Verbinden
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Container')}</label>
        <select className="input input--rect" value={container} onChange={(e) => setContainer(e.target.value)} style={{ cursor: 'pointer' }}>
          {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label">Feste IP (optional)</label>
        <input className="input input--rect" placeholder={net?.subnet ? net.subnet.replace(/0\/\d+$/, '50') : '192.168.50.50'} value={ip} onChange={(e) => setIp(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">Muss im Subnetz {net?.subnet || '—'} liegen.</div></div>
      <div className="form-group"><label className="form-label">Alias-Namen / weitere IPs (Komma-getrennt)</label>
        <input className="input input--rect" placeholder={tt('web, api, db')} value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
    </Modal>
  );
}

// Bridge-Gruppe: ein Bridge-Netz anlegen und mehrere Container in einem Schritt
// hinzufügen. Container derselben Gruppe erreichen sich (per Name), andere sind getrennt.
function CreateGroupModal({ open, onClose, onDone, containers }: { open: boolean; onClose: () => void; onDone: () => void; containers: { id: string; name: string }[] }) {
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) { setName(''); setSel([]); setError(''); } }, [open]);
  const toggle = (id: string) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const save = async () => {
    const nm = name.trim().replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!nm) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.networks.create({ name: nm, driver: 'bridge' });
      const net = (await api.networks.list()).networks.find((n) => n.name === nm);
      if (net) { for (const c of sel) { try { await api.networks.connect(net.id, c); } catch { /* einzelner Container evtl. schon verbunden */ } } }
      onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Bridge-Gruppe erstellen')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} {tt('Gruppe erstellen')}
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Gruppenname')}</label>
        <input className="input input--rect" placeholder={tt('z.B. web-stack')} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">{tt('Container in dieser Gruppe')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px' }}>
          {containers.length === 0 ? <span className="text-muted text-sm">{tt('Keine Container vorhanden.')}</span> :
            containers.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}
              </label>
            ))}
        </div>
        <div className="form-hint">{tt('Container derselben Gruppe erreichen sich gegenseitig (per Container-Name). Andere Gruppen sind voneinander getrennt.')}</div>
      </div>
    </Modal>
  );
}

type FwForm = { action: 'allow' | 'deny' | 'reject'; port: string; proto: string; from: string; direction: string; comment: string };
const EMPTY_FW_FORM: FwForm = { action: 'allow', port: '', proto: '', from: '', direction: '', comment: '' };

/** Bestehende Regel bestmöglich in Formularfelder zerlegen (zum Bearbeiten). */
function ruleToForm(r: FirewallRule): FwForm {
  const m = r.to.match(/^(\d+(?::\d+)?)\/?(tcp|udp)?$/i);
  return {
    action: (r.action.toLowerCase() as 'allow' | 'deny' | 'reject') ?? 'allow',
    port: m ? m[1] : '',
    proto: m && m[2] ? m[2].toLowerCase() : '',
    from: /anywhere/i.test(r.from) ? '' : r.from.replace(/\s*\(v6\)/i, '').trim(),
    direction: (r.direction ?? '').toLowerCase(),
    comment: r.comment ?? '',
  };
}

const DIR_LABEL: Record<string, string> = { IN: 'Eingehend', OUT: 'Ausgehend', '': '–' };

function FirewallPanel() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [disabled, setDisabled] = useState<FirewallDisabledRule[]>([]);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<FwForm>(EMPTY_FW_FORM);
  const [editNum, setEditNum] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.firewall.list();
    setRules(res.rules); setDisabled(res.disabled ?? []);
    setAvailable(res.available); setActive(res.active); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (r: FirewallRule) => { setEditNum(r.num); setForm(ruleToForm(r)); };
  const cancelEdit = () => { setEditNum(null); setForm(EMPTY_FW_FORM); };

  const submit = async () => {
    if (!form.port && !form.from) { alert(tt('Port oder Quell-IP angeben')); return; }
    setBusy(true);
    const payload = { action: form.action, port: form.port || undefined, proto: form.proto || undefined, from: form.from || undefined, direction: form.direction || undefined, comment: form.comment || undefined };
    try {
      if (editNum !== null) await api.firewall.update(editNum, payload);
      else await api.firewall.add(payload);
      setForm(EMPTY_FW_FORM); setEditNum(null);
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const del = async (num: number) => {
    if (!confirm(tt('Regel löschen?'))) return;
    try { await api.firewall.remove(num); if (editNum === num) cancelEdit(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  // Regel deaktivieren (merkt sich die Regel zum späteren Reaktivieren)
  const disableRule = async (r: FirewallRule) => {
    const f = ruleToForm(r);
    const isPort = /^\d+(?::\d+)?(?:\/(tcp|udp))?$/i.test(r.to);
    try {
      await api.firewall.disable(r.num, {
        action: f.action, port: f.port || undefined, proto: f.proto || undefined,
        from: f.from || undefined, direction: f.direction || undefined,
        comment: r.comment || undefined, profile: isPort ? undefined : r.to,
      });
      if (editNum === r.num) cancelEdit();
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const enableRule = async (id: number) => {
    try { await api.firewall.enableDisabled(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };
  const discardDisabled = async (id: number) => {
    if (!confirm(tt('Deaktivierte Regel endgültig verwerfen?'))) return;
    try { await api.firewall.removeDisabled(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const q = filter.trim().toLowerCase();
  const shownRules = q
    ? rules.filter((r) => `${r.comment ?? ''} ${r.to} ${r.from} ${r.action} ${r.direction ?? ''}`.toLowerCase().includes(q))
    : rules;
  const shownDisabled = q
    ? disabled.filter((d) => `${d.comment} ${d.to} ${d.from} ${d.action}`.toLowerCase().includes(q))
    : disabled;

  return (
    <Panel
      title={tt('Firewall (ufw)')}
      icon={<Shield size={15} />}
      subtitle={available ? (active ? 'aktiv' : 'inaktiv') : 'nicht installiert'}
      storageKey="firewall"
      defaultCollapsed
      actions={available && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn--outline btn--sm"
            title={tt('Alle Regeln löschen und nur SSH/HTTPS fürs LAN neu setzen')}
            onClick={async () => {
              if (!confirm(
                'Firewall auf Standard zurücksetzen?\n\n' +
                'ALLE ufw-Regeln werden gelöscht. Danach sind NUR SSH (Port 22) und HTTPS (Port 443) ' +
                'für dein lokales Netz (LAN) offen – alles andere ist gesperrt (jederzeit wieder freischaltbar).\n\n' +
                'Fortfahren?'
              )) return;
              await api.firewall.reset().catch((e: Error) => alert(e.message));
              load();
            }}
          >
            <RotateCcw size={12} /> {tt('Zurücksetzen')}
          </button>
          <Switch checked={active} onChange={async (v) => {
            if (v) {
              const ok = confirm(
                'Firewall aktivieren?\n\n' +
                'SSH (Port 22) und Web-UI (Port 443) werden – falls noch keine Regel existiert – ' +
                'automatisch NUR für dein lokales Netz (LAN) freigegeben, niemals fürs Internet. ' +
                'Alle anderen Ports musst du selbst freischalten.'
              );
              if (!ok) return;
            }
            await api.firewall.toggle(v).catch((e: Error) => alert(e.message));
            load();
          }} />
        </div>
      )}
    >
      {!available ? (
        <div className="empty-state" style={{ padding: '30px 20px' }}>
          <div className="empty-state__desc">{message}<br /><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '3px 7px', borderRadius: 5 }}>sudo apt install ufw</code></div>
        </div>
      ) : (
        <>
          {editNum !== null && (
            <div style={{ fontSize: 12, color: 'var(--color-accent)', marginTop: 6, marginBottom: 2, fontWeight: 600 }}>
              Regel #{editNum} bearbeiten
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8, marginBottom: 6 }}>
            <input className="input input--rect" placeholder={tt('Name (optional)')} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} style={{ width: 150 }} title={tt('Name / Bezeichnung der Regel')} />
            <select className="input input--rect" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'allow' })} style={{ width: 92, cursor: 'pointer' }} title={tt('Aktion')}>
              <option value="allow">allow</option><option value="deny">deny</option><option value="reject">reject</option>
            </select>
            <select className="input input--rect" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 152, cursor: 'pointer' }} title={tt('Richtung – Beide legt je eine Regel für ein- und ausgehend an')}>
              <option value="">{tt('Richtung: –')}</option><option value="in">Eingehend (in)</option><option value="out">Ausgehend (out)</option><option value="both">Beide (ein + aus)</option>
            </select>
            <input className="input input--rect" placeholder={tt('Port (z.B. 443)')} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 110 }} />
            <select className="input input--rect" value={form.proto} onChange={(e) => setForm({ ...form, proto: e.target.value })} style={{ width: 86, cursor: 'pointer' }}>
              <option value="">tcp+udp</option><option value="tcp">tcp</option><option value="udp">udp</option>
            </select>
            <input className="input input--rect" placeholder={tt('von IP(s), mit Komma trennen')} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 200, fontFamily: 'var(--font-mono)' }} title={tt('Mehrere Quell-Adressen mit Komma/Leerzeichen trennen → je eine Regel')} />
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy}>
              {editNum !== null ? <><Pencil size={13} /> {tt('Speichern')}</> : <><Plus size={13} /> {tt('Regel')}</>}
            </button>
            {editNum !== null && <button className="btn btn--ghost btn--sm" onClick={cancelEdit}><X size={13} /> {tt('Abbrechen')}</button>}
          </div>

          {(rules.length > 0 || disabled.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 10px' }}>
              <input className="input input--rect" placeholder={tt('Regeln filtern (Name, Port, IP …)')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
              {filter && <button className="btn btn--ghost btn--sm" onClick={() => setFilter('')}><X size={12} /></button>}
              <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{shownRules.length} aktiv{disabled.length ? ` · ${shownDisabled.length} deaktiviert` : ''}</span>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>{tt('Keine Regeln.')}</div>
          ) : (
            <table className="dtable">
              <thead><tr><th style={{ width: 30 }}>#</th><th>{tt('Name')}</th><th>{tt('Ziel')}</th><th>{tt('Aktion')}</th><th>{tt('Richtung')}</th><th>{tt('Von')}</th><th style={{ width: 56 }}>{tt('Aktiv')}</th><th style={{ width: 70 }}></th></tr></thead>
              <tbody>
                {shownRules.map((r) => (
                  <tr key={r.num} style={editNum === r.num ? { background: 'var(--color-accent-subtle, rgba(99,102,241,.08))' } : undefined}>
                    <td className="dtable__mono text-muted">{r.num}</td>
                    <td style={{ fontWeight: 600 }}>{r.comment || <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>–</span>}</td>
                    <td className="dtable__mono">{r.to}</td>
                    <td><span className={`badge badge--${r.action === 'ALLOW' ? 'running' : 'dead'}`}>{r.action}</span></td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[r.direction ?? ''] ?? r.direction}</td>
                    <td className="dtable__mono text-muted">{r.from}</td>
                    <td><div onClick={(e) => e.stopPropagation()}><Switch checked onChange={() => void disableRule(r)} /></div></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Bearbeiten')} onClick={() => startEdit(r)}><Pencil size={12} /></button>
                        <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} onClick={() => del(r.num)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Deaktivierte Regeln (Parkbucht) */}
          {shownDisabled.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 6 }}>
                Deaktivierte Regeln <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>(nicht aktiv – jederzeit reaktivierbar)</span>
              </div>
              <table className="dtable">
                <tbody>
                  {shownDisabled.map((d) => (
                    <tr key={d.id} style={{ opacity: 0.7 }}>
                      <td style={{ fontWeight: 600 }}>{d.comment || <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>–</span>}</td>
                      <td className="dtable__mono">{d.to}</td>
                      <td><span className="badge badge--stopped">{(d.action || '').toUpperCase()}</span></td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[d.direction] ?? d.direction}</td>
                      <td className="dtable__mono text-muted">{/anywhere/i.test(d.from) || !d.from ? 'Anywhere' : d.from}</td>
                      <td style={{ width: 56 }}><div onClick={(e) => e.stopPropagation()}><Switch checked={false} onChange={() => void enableRule(d.id)} /></div></td>
                      <td style={{ width: 40 }}><button className="btn btn--danger btn--icon btn--sm" title={tt('Verwerfen')} onClick={() => discardDisabled(d.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

const LOG_ACTION_BADGE: Record<string, string> = { BLOCK: 'dead', ALLOW: 'running', LIMIT: 'restarting', AUDIT: 'stopped' };

function csvCell(v: string): string {
  const s = v ?? '';
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: FirewallLogEntry[], filename: string) {
  const header = ['Zeit', 'Aktion', 'Richtung', 'Quell-IP', 'Quell-Port', 'Ziel-IP', 'Ziel-Port', 'Protokoll', 'Schnittstelle', 'Dienst (Ziel-Port)'];
  const lines = [header.join(';')];
  for (const e of rows) {
    lines.push([
      e.ts, e.action, e.direction, e.src, e.spt, e.dst, e.dpt, e.proto, e.iface, portInfo(e.dpt).name,
    ].map(csvCell).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function QuickRuleModal({ entry, open, onClose, onDone }: {
  entry: FirewallLogEntry | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState<'allow' | 'deny' | 'reject'>('allow');
  const [from, setFrom] = useState('');
  const [port, setPort] = useState('');
  const [proto, setProto] = useState('');
  const [direction, setDirection] = useState('in');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (entry) {
      setFrom(entry.src || '');
      setPort(entry.dpt || '');
      setProto((entry.proto || '').toLowerCase());
      setDirection((entry.direction || 'IN').toLowerCase());
      setAction('allow');
      setComment('');
      setError('');
    }
  }, [entry, open]);

  const submit = async () => {
    if (!port && !from) { setError('Port oder Quell-IP angeben'); return; }
    setBusy(true); setError('');
    try {
      await api.firewall.add({
        action,
        port: port || undefined,
        proto: proto || undefined,
        from: from || undefined,
        direction: direction || undefined,
        comment: comment || undefined,
      });
      onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={tt('Firewall-Regel aus Verbindung erstellen')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className={`btn btn--${action === 'allow' ? 'primary' : 'danger'} btn--sm`} onClick={submit} disabled={busy}>
          {busy && <span className="spinner" style={{ width: 12, height: 12 }} />} Regel anlegen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
        Erstelle eine Firewall-Regel basierend auf dieser Verbindung. Alle Felder sind anpassbar.
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Aktion')}</label>
          <select className="input input--rect" value={action} onChange={(e) => setAction(e.target.value as 'allow' | 'deny' | 'reject')} style={{ cursor: 'pointer' }}>
            <option value="allow">Erlauben (allow)</option>
            <option value="deny">Blockieren (deny)</option>
            <option value="reject">Ablehnen (reject)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Richtung')}</label>
          <select className="input input--rect" value={direction} onChange={(e) => setDirection(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="in">Eingehend (in)</option>
            <option value="out">Ausgehend (out)</option>
            <option value="both">Beide (ein + aus)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Von IP (Quelle)</label>
        <input className="input input--rect" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder={tt('leer = alle Quellen')} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Ziel-Port')}</label>
          <input className="input input--rect" value={port} onChange={(e) => setPort(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder={tt('z.B. 443')} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Protokoll')}</label>
          <select className="input input--rect" value={proto} onChange={(e) => setProto(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="">tcp+udp</option>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Name / Bezeichnung (optional)</label>
        <input className="input input--rect" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tt('z.B. Heimnetz erlauben')} />
      </div>
    </Modal>
  );
}

function ConnectionsPanel() {
  const [entries, setEntries] = useState<FirewallLogEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [logging, setLogging] = useState(false);
  const [level, setLevel] = useState('low');
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<'all' | 'BLOCK' | 'ALLOW'>('all');
  const [dirFilter, setDirFilter] = useState<'all' | 'IN' | 'OUT'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quickRule, setQuickRule] = useState<FirewallLogEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.firewall.log(2000);
      setEntries(res.entries); setAvailable(res.available); setLogging(res.logging);
      setLevel(res.level ?? 'low');
      setTotal(res.total ?? res.entries.length); setMessage(res.message ?? '');
      setSelected(new Set());
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleLogging = async (v: boolean) => {
    // Beim Einschalten gleich auf "medium" gehen, damit auch erlaubte Verbindungen erscheinen
    const lvl = v ? (level === 'off' || level === 'low' ? 'medium' : level) : 'off';
    try { const r = await api.firewall.setLogging(v, lvl); setLogging(v); setLevel(r.level ?? lvl); setTimeout(() => void load(), 600); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const changeLevel = async (lvl: string) => {
    try { const r = await api.firewall.setLogging(lvl !== 'off', lvl); setLevel(r.level ?? lvl); setLogging(lvl !== 'off'); setTimeout(() => void load(), 600); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const clearLog = async () => {
    if (!confirm(tt('Das gesamte Verbindungsprotokoll löschen?'))) return;
    try { await api.firewall.clearLog(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const filtered = entries.filter((e) => {
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (dirFilter !== 'all' && e.direction !== dirFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${e.src} ${e.dst} ${e.dpt} ${e.spt} ${e.proto} ${e.iface}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const blocked = entries.filter((e) => e.action === 'BLOCK').length;
  const allSelected = filtered.length > 0 && filtered.every((_, i) => selected.has(i));
  const selRows = filtered.filter((_, i) => selected.has(i));

  const toggleRow = (i: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((_, i) => i)));

  const exportSelected = () => downloadCsv(selRows.length ? selRows : filtered, `verbindungen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
  const exportAll = () => downloadCsv(filtered, `verbindungen-alle-${new Date().toISOString().slice(0, 10)}.csv`);

  return (
    <Panel
      title={tt('Verbindungsversuche')}
      icon={<Activity size={15} />}
      subtitle={available ? `${total} im Protokoll · ${blocked} blockiert (geladen)` : 'nicht verfügbar'}
      storageKey="fw-connections"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Protokollierung')}</span>
          <Switch checked={logging} onChange={toggleLogging} />
          {logging && (
            <select className="input input--rect" value={level} onChange={(e) => void changeLevel(e.target.value)} style={{ width: 188, cursor: 'pointer', fontSize: 12 }} title={tt('Logging-Stufe – ab Mittel werden auch erlaubte Verbindungen protokolliert')}>
              <option value="low">Stufe: Niedrig (nur blockiert)</option>
              <option value="medium">Stufe: Mittel (auch erlaubt)</option>
              <option value="high">Stufe: Hoch (alles)</option>
              <option value="full">Stufe: Voll (alles, ungedrosselt)</option>
            </select>
          )}
          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Aktualisieren')} onClick={() => void load()}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />}
          </button>
        </div>
      }
    >
      {!available ? (
        <div className="empty-state" style={{ padding: '30px 20px' }}>
          <div className="empty-state__desc">{message || 'ufw nicht installiert.'}</div>
        </div>
      ) : (
        <>
          {!logging && (
            <div style={{ background: 'rgba(234,179,8,.1)', border: '1px solid var(--color-warning)', borderRadius: 8, padding: '10px 14px', margin: '8px 0 12px', fontSize: 12.5, color: 'var(--color-warning)' }}>
              ⚠ Die Firewall-Protokollierung ist <b>aus</b>. Ohne sie werden keine Verbindungsversuche aufgezeichnet.
              Schalte sie oben rechts ein, um zu sehen, wer von wo zugreift.
            </div>
          )}
          {logging && level === 'low' && (
            <div style={{ background: 'rgba(59,130,246,.1)', border: '1px solid var(--color-accent)', borderRadius: 8, padding: '10px 14px', margin: '8px 0 12px', fontSize: 12.5, color: 'var(--color-accent)' }}>
              ℹ Auf Stufe <b>{tt('Niedrig')}</b> protokolliert ufw nur <b>blockierte</b> {tt('Pakete – deshalb siehst du hier nur')} <b>BLOCK</b>.
              Stelle die Stufe oben rechts auf <b>{tt('Mittel')}</b> (oder höher), damit auch <b>erlaubte</b> Verbindungen (ALLOW) erscheinen.
              <span style={{ color: 'var(--color-muted)' }}> {tt('Hinweis: Höhere Stufen erzeugen deutlich mehr Logeinträge.')}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 10px' }}>
            <select className="input input--rect" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as 'all')} style={{ width: 150, cursor: 'pointer' }}>
              <option value="all">{tt('Alle Aktionen')}</option><option value="BLOCK">{tt('Nur blockiert')}</option><option value="ALLOW">{tt('Nur erlaubt')}</option>
            </select>
            <select className="input input--rect" value={dirFilter} onChange={(e) => setDirFilter(e.target.value as 'all')} style={{ width: 140, cursor: 'pointer' }}>
              <option value="all">{tt('Beide Richtungen')}</option><option value="IN">{tt('Eingehend')}</option><option value="OUT">{tt('Ausgehend')}</option>
            </select>
            <input className="input input--rect" placeholder={tt('Filter: IP, Port, Protokoll…')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200, fontFamily: 'var(--font-mono)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{filtered.length} angezeigt{selRows.length ? ` · ${selRows.length} ausgewählt` : ''}</span>
          </div>

          {/* Export- & Verwaltungsleiste */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <button className="btn btn--outline btn--sm" onClick={exportSelected} disabled={filtered.length === 0}>
              <Download size={13} /> {selRows.length ? `Auswahl als CSV (${selRows.length})` : 'Angezeigte als CSV'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exportAll} disabled={filtered.length === 0}>
              <Download size={13} /> Alle als CSV
            </button>
            <button className="btn btn--danger btn--sm" style={{ marginLeft: 'auto' }} onClick={clearLog}>
              <Trash2 size={13} /> Protokoll leeren
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>
              {entries.length === 0 ? 'Noch keine protokollierten Verbindungen.' : 'Keine Treffer für den Filter.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="dtable">
                <thead><tr>
                  <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title={tt('Alle (angezeigten) auswählen')} /></th>
                  <th>{tt('Zeit')}</th><th>{tt('Aktion')}</th><th>{tt('Richtung')}</th><th>{tt('Quell-IP')}</th><th>{tt('Ziel-Port')}</th><th>{tt('Dienst')}</th><th>{tt('Protokoll')}</th><th>{tt('Schnittstelle')}</th><th style={{ width: 44 }}></th>
                </tr></thead>
                <tbody>
                  {filtered.map((e, i) => {
                    const pi = portInfo(e.dpt);
                    return (
                      <tr key={i} style={selected.has(i) ? { background: 'var(--color-accent-subtle, rgba(99,102,241,.08))' } : undefined}>
                        <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} /></td>
                        <td className="text-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{e.ts || '–'}</td>
                        <td><span className={`badge badge--${LOG_ACTION_BADGE[e.action] ?? 'stopped'}`}>{e.action}</span></td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[e.direction] ?? e.direction}</td>
                        <td className="dtable__mono" style={{ fontWeight: 600 }}>{e.src || '–'}</td>
                        <td className="dtable__mono" title={pi.hint}>{e.dpt || '–'}</td>
                        <td title={pi.hint} style={{ fontSize: 12, cursor: 'help', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {pi.risky && <AlertTriangle size={12} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />}
                          <span style={{ color: pi.name === 'Kein Standarddienst' || pi.name === 'Dynamischer Port' || pi.name === 'System-Port' ? 'var(--color-faint)' : 'var(--color-fg)' }}>{pi.name}</span>
                        </td>
                        <td className="text-muted">{e.proto || '–'}</td>
                        <td className="dtable__mono text-muted">{e.iface || '–'}</td>
                        <td>
                          <button
                            className="btn btn--ghost btn--icon btn--sm"
                            title={tt('Firewall-Regel aus dieser Verbindung erstellen')}
                            onClick={() => setQuickRule(e)}
                          >
                            <ShieldPlus size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <QuickRuleModal entry={quickRule} open={!!quickRule} onClose={() => setQuickRule(null)} onDone={load} />
        </>
      )}
    </Panel>
  );
}

function CreateVmNetModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('nat');
  const [subnet, setSubnet] = useState('192.168.123.0');
  const [bridge, setBridge] = useState('br0');
  const [vlan, setVlan] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.vmNetworks.create({ name, mode, subnet: subnet || undefined, bridge: bridge || undefined, vlan: vlan || undefined });
      setName(''); setVlan(''); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Neues VM-Netzwerk')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">{tt('Name')}</label>
          <input className="input input--rect" placeholder={tt('vm-dmz')} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Modus')}</label>
          <select className="input input--rect" value={mode} onChange={(e) => setMode(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="nat">NAT (Internet über Host)</option>
            <option value="isolated">Isoliert (kein Außenzugriff)</option>
            <option value="bridge">Bridge (direkt im LAN)</option>
          </select></div>
      </div>
      {mode !== 'bridge' ? (
        <div className="form-group"><label className="form-label">{tt('Subnetz')}</label>
          <input className="input input--rect" placeholder="192.168.123.0" value={subnet} onChange={(e) => setSubnet(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">DHCP wird automatisch eingerichtet (.2–.254).</div></div>
      ) : (
        <div className="form-row">
          <div className="form-group"><label className="form-label">{tt('Host-Bridge')}</label>
            <input className="input input--rect" placeholder={tt('br0')} value={bridge} onChange={(e) => setBridge(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder={tt('z.B. 100')} value={vlan} onChange={(e) => setVlan(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

function AttachVmModal({ net, open, onClose, onDone }: { net: VmNetwork | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [vms, setVms] = useState<VM[]>([]);
  const [vm, setVm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.vms.list().then((r) => { setVms(r.vms); if (r.vms[0]) setVm(r.vms[0].name); }).catch(() => {});
  }, [open]);

  const save = async () => {
    if (!net || !vm) { setError('VM wählen'); return; }
    setLoading(true); setError('');
    try { await api.vmNetworks.attach(net.name, vm); onDone(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={`VM anhängen → ${net?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Anhängen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Virtuelle Maschine')}</label>
        <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
          {vms.length === 0 && <option value="">{tt('Keine VMs')}</option>}
          {vms.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
        <div className="form-hint">Hängt eine virtio-Netzwerkkarte an (config + live).</div></div>
    </Modal>
  );
}

function VmNetworksView() {
  const [networks, setNetworks] = useState<VmNetwork[]>([]);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [attachNet, setAttachNet] = useState<VmNetwork | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await api.vmNetworks.list();
    setNetworks(res.networks); setAvailable(res.available); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (name: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy((b) => ({ ...b, [name]: true }));
    try { await fn(); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[name]; return n; }); }
  };

  if (!available) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><MonitorPlay size={44} strokeWidth={1} /></div>
        <div className="empty-state__title">libvirt nicht installiert</div>
        <div className="empty-state__desc">{message}<br /><br /><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>sudo apt install qemu-kvm libvirt-daemon-system</code></div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> {tt('VM-Netzwerk')}</button>
      </div>
      {networks.length === 0 ? (
        <div className="empty-state"><div className="empty-state__desc">{tt('Keine VM-Netzwerke. Erstelle eins mit dem Button oben.')}</div></div>
      ) : (
        <Panel title={tt('libvirt-Netzwerke')} icon={<Network size={15} />} subtitle={`${networks.length}`} storageKey="vmnets">
          <table className="dtable" style={{ marginTop: 6 }}>
            <thead><tr><th>{tt('Name')}</th><th>{tt('Modus')}</th><th>{tt('Bridge')}</th><th>{tt('Status')}</th><th>{tt('Autostart')}</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td style={{ fontWeight: 600 }}>{n.name}</td>
                  <td><span className="badge badge--paused">{n.forward}</span></td>
                  <td className="dtable__mono text-muted">{n.bridge || '—'}</td>
                  <td><span className={`badge badge--${n.active ? 'running' : 'stopped'}`}><span className="badge__dot" />{n.active ? 'aktiv' : 'gestoppt'}</span></td>
                  <td>{n.autostart ? <Star size={13} fill="var(--color-warning)" color="var(--color-warning)" /> : '—'}</td>
                  <td>
                    <div className="dtable__actions">
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('VM anhängen')} onClick={() => setAttachNet(n)}><Link size={12} /></button>
                      {n.active
                        ? <button className="btn btn--ghost btn--icon btn--sm" title={tt('Stoppen')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.stop(n.name))}><Square size={12} /></button>
                        : <button className="btn btn--ghost btn--icon btn--sm" title={tt('Starten')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.start(n.name))}><Play size={12} /></button>}
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('Autostart umschalten')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.autostart(n.name))} style={n.autostart ? { color: 'var(--color-warning)' } : undefined}><Star size={12} /></button>
                      <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.remove(n.name), `VM-Netzwerk "${n.name}" löschen?`)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <CreateVmNetModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} />
      <AttachVmModal net={attachNet} open={!!attachNet} onClose={() => setAttachNet(null)} onDone={load} />
    </>
  );
}

const DRIVER_BADGE: Record<string, string> = { macvlan: 'running', ipvlan: 'restarting', bridge: 'paused', host: 'paused', overlay: 'stopped' };

function VirtualIpsPanel() {
  const [entries, setEntries] = useState<ContainerNetworkEntry[]>([]);
  const [vmEntries, setVmEntries] = useState<VmIpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'macvlan' | 'ipvlan' | 'bridge'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.containers.virtualIps();
      setEntries(r.entries);
      setVmEntries(r.vmEntries);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = entries.filter((e) => filter === 'all' || e.driver === filter);
  const drivers = [...new Set(entries.map((e) => e.driver))].filter((d) => ['macvlan', 'ipvlan', 'bridge'].includes(d));

  return (
    <Panel title={tt('Virtuelle IPs — Übersicht')} icon={<Network size={15} />} storageKey="vips-panel">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="filter-tabs" style={{ margin: 0 }}>
          <button className={`filter-tab${filter === 'all' ? ' filter-tab--active' : ''}`} onClick={() => setFilter('all')}>{tt('Alle')}</button>
          {drivers.map((d) => (
            <button key={d} className={`filter-tab${filter === d ? ' filter-tab--active' : ''}`} onClick={() => setFilter(d as typeof filter)}>{d}</button>
          ))}
        </div>
        <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />} Aktualisieren
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : filtered.length === 0 && vmEntries.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-state__icon"><Network size={36} strokeWidth={1.2} /></div>
          <div className="empty-state__title">{tt('Keine Einträge')}</div>
          <div className="empty-state__desc">
            Noch kein Container mit einem benutzerdefinierten Netzwerk verbunden.<br />
            Für eine echte LAN-IP: erst ein <b>macvlan</b>- oder <b>ipvlan</b>-Netzwerk anlegen (Docker-Tab), dann im Container-Bearbeiten-Dialog das Netzwerk hinzufügen.
          </div>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{tt('Container')}</th>
                  <th>{tt('Netzwerk')}</th>
                  <th>{tt('Treiber')}</th>
                  <th>{tt('IP-Adresse')}</th>
                  <th>MAC</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{e.containerName}</td>
                    <td>{e.networkName}</td>
                    <td><span className={`badge badge--${DRIVER_BADGE[e.driver] ?? 'paused'}`}>{e.driver}</span></td>
                    <td className="dtable__mono" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{e.ipv4 ? e.ipv4.replace(/\/\d+$/, '') : '—'}</td>
                    <td className="dtable__mono text-muted" style={{ fontSize: 11 }}>{e.mac || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vmEntries.length > 0 && (
            <>
              <div style={{ margin: '16px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Virtuelle Maschinen (DHCP-Leases)</div>
              <div className="table-scroll">
                <table className="dtable">
                  <thead><tr><th>{tt('VM / Hostname')}</th><th>{tt('IP-Adresse')}</th><th>MAC</th><th>{tt('Netzwerk')}</th></tr></thead>
                  <tbody>
                    {vmEntries.map((v, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{v.vmName}</td>
                        <td className="dtable__mono" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{v.ipv4}</td>
                        <td className="dtable__mono text-muted" style={{ fontSize: 11 }}>{v.mac}</td>
                        <td className="text-muted">{v.networkName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Konnektivität: Wer kann wen erreichen (aus Docker-Netzwerk-Zugehörigkeit) ──
function ConnectivityPanel({ networks, containers }: { networks: DockerNetwork[]; containers: Container[] }) {
  type Mem = { net: string; driver: string; internal: boolean; ip: string };
  const memberships = new Map<string, Mem[]>();
  const allNames = new Set<string>();
  for (const n of networks) {
    if (n.name === 'none') continue;
    for (const c of n.containers) {
      if (!memberships.has(c.name)) memberships.set(c.name, []);
      memberships.get(c.name)!.push({ net: n.name, driver: n.driver, internal: n.internal, ip: (c.ipv4 || '').replace(/\/\d+$/, '') });
      allNames.add(c.name);
    }
  }
  const names = [...allNames].sort();

  // Veröffentlichte Host-Ports je Container (aus "0.0.0.0:8080->80/tcp")
  const pub = new Map<string, string[]>();
  for (const c of containers) {
    const ps = (c.ports || []).filter((p) => p.includes('->')).map((p) => p.split('->')[0].split(':').pop() || '').filter(Boolean);
    if (ps.length) pub.set(c.name, [...new Set(ps)]);
  }

  const sharesNet = (a: string, b: string) => {
    const ma = memberships.get(a) || [], mb = memberships.get(b) || [];
    return ma.some((x) => mb.some((y) => y.net === x.net));
  };
  const hostReaches = (a: string) =>
    (memberships.get(a) || []).some((m) => m.driver === 'host' || (m.driver === 'bridge' && !m.internal)) || (pub.get(a)?.length ?? 0) > 0;
  const lanReaches = (a: string) =>
    (memberships.get(a) || []).some((m) => m.driver === 'macvlan' || m.driver === 'ipvlan') || (pub.get(a)?.length ?? 0) > 0;

  const cell = (ok: boolean, self = false) => self
    ? <span style={{ color: 'var(--color-faint)' }}>—</span>
    : ok ? <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span>
         : <span style={{ color: 'var(--color-faint)' }}>✕</span>;

  const named = networks.filter((n) => n.name !== 'none');

  return (
    <Panel title={tt('Konnektivität – wer erreicht wen')} icon={<Network size={15} />} storageKey="net-connectivity">
      <div style={{ fontSize: 12, color: 'var(--color-muted)', margin: '6px 0 14px', lineHeight: 1.6 }}>
        {tt('Zeigt, wer wen technisch erreichen kann (basierend auf Docker-Netzwerk-Zugehörigkeit). Container im selben Netzwerk erreichen sich gegenseitig.')}
      </div>

      {names.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 20px' }}><div className="empty-state__desc">{tt('Keine laufenden Container.')}</div></div>
      ) : (
        <>
          {/* Matrix */}
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{tt('Von ↓ / Ziel →')}</th>
                  {names.map((n) => <th key={n} style={{ fontSize: 11 }}>{n}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>🖥 {tt('Host')}</td>
                  {names.map((n) => <td key={n} style={{ textAlign: 'center' }}>{cell(hostReaches(n))}</td>)}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>🌐 LAN / Router</td>
                  {names.map((n) => <td key={n} style={{ textAlign: 'center' }}>{cell(lanReaches(n))}</td>)}
                </tr>
                {names.map((from) => (
                  <tr key={from}>
                    <td style={{ fontWeight: 600 }}>📦 {from}</td>
                    {names.map((to) => <td key={to} style={{ textAlign: 'center' }}>{cell(from === to ? false : sharesNet(from, to), from === to)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Netzwerk-Gruppen */}
          <div style={{ margin: '18px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tt('Netzwerke & Mitglieder')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {named.map((n) => (
              <div key={n.id} style={{ flex: '1 1 240px', minWidth: 220, border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, background: 'var(--color-surface-sunken)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{n.name}</span>
                  <span className={`badge badge--${DRIVER_BADGE[n.driver] ?? 'paused'}`}>{n.driver}</span>
                  {n.internal && <span className="badge badge--dead">isoliert</span>}
                </div>
                {n.subnet && <div className="dtable__mono" style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 6 }}>{n.subnet}</div>}
                {n.containers.length === 0 ? (
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{tt('Keine Mitglieder')}</div>
                ) : n.containers.map((c) => (
                  <div key={c.container} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                    <span>📦 {c.name}</span>
                    <span className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{(c.ipv4 || '').replace(/\/\d+$/, '') || '—'}</span>
                  </div>
                ))}
                {(n.driver === 'bridge' && !n.internal) && <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 6 }}>🖥 {tt('vom Host erreichbar')}</div>}
                {(n.driver === 'macvlan' || n.driver === 'ipvlan') && <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 6 }}>🌐 {tt('LAN-erreichbar, vom Host NICHT')}</div>}
              </div>
            ))}
          </div>

          {/* Legende */}
          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--color-faint)', lineHeight: 1.7 }}>
            <b>{tt('Legende')}:</b> ✓ = {tt('kann erreichen')} · ✕ = {tt('kein Weg')} · {tt('Container im selben Netzwerk erreichen sich auf ihren internen Ports')}.<br />
            🖥 {tt('Host')}: {tt('erreicht Bridge-Container & veröffentlichte Ports, aber KEINE Macvlan-IPs')} · 🌐 LAN: {tt('erreicht Macvlan-IPs & veröffentlichte Host-Ports')}.
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Firewall-/Netzwerk-Studio: frei anordbare Karte (Phase A) ────────────────
interface StudioNode { id: string; kind: 'host' | 'zone' | 'docker' | 'vm' | 'ext'; label: string; sub?: string; ip?: string; reach?: string; ports?: string[]; nets?: { net: string; driver: string }[]; zone?: string; }
type CZone = { id: string; label: string; sub?: string; cidr?: string; type?: 'lan' | 'internet' | 'tunnel' | 'device'; container?: string };
// Fremdes Objekt (VPS im Internet, PC/Server im LAN) – vom Benutzer angelegt
type CHost = { id: string; name: string; type: 'vps' | 'pc' | 'server'; zone: string; ip?: string; note?: string };

// Formular-Fenster für fremde Server/PCs (Internet-VPS, LAN-Rechner)
function HostModal({ open, host, zones, onClose, onSave }: { open: boolean; host?: CHost; zones: { key: string; label: string }[]; onClose: () => void; onSave: (h: CHost, existing?: CHost) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CHost['type']>('vps');
  const [zone, setZone] = useState('internet');
  const [ip, setIp] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(host?.name || ''); setType(host?.type || 'vps');
    setZone(host?.zone || 'internet'); setIp(host?.ip || ''); setNote(host?.note || '');
  }, [open, host]);
  if (!open) return null;
  const save = () => {
    if (!name.trim()) return;
    onSave({ id: host?.id || `ext:${Date.now()}`, name: name.trim(), type, zone, ip: ip.trim() || undefined, note: note.trim() || undefined }, host);
    onClose();
  };
  return (
    <Modal open={open} title={host ? tt('Objekt bearbeiten') : tt('Server/PC hinzufügen')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={!name.trim()}>{tt('Speichern')}</button>
      </>}>
      <div className="form-group">
        <label className="form-label">{tt('Name')}</label>
        <input className="input input--rect" autoFocus placeholder={tt('z. B. Pangolin-VPS, Büro-PC, NAS')} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Art')}</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['vps', tt('VPS (Internet)')], ['server', tt('Server')], ['pc', tt('PC/Gerät')]] as const).map(([v, l]) => (
            <button key={v} type="button" className={`btn btn--sm ${type === v ? 'btn--primary' : 'btn--outline'}`} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Bereich')}</label>
          <select className="input input--rect" value={zone} onChange={(e) => setZone(e.target.value)}>
            {zones.map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">IP/Host</label>
          <input className="input input--rect" placeholder="203.0.113.5" value={ip} onChange={(e) => setIp(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Notiz')} {tt('(optional)')}</label>
        <input className="input input--rect" placeholder={tt('z. B. Standort, Zweck')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="form-hint">{tt('SSH-Zugang für echte Tests von diesem Gerät aus richtest du danach im Inspector ein.')}</div>
    </Modal>
  );
}

// SSH-Zugang zu einem fremden Objekt (verschlüsselt gespeichert)
function SshModal({ open, node, existing, onClose, onSaved }: { open: boolean; node: StudioNode | null; existing?: { host: string; port: number; username: string; auth_type: 'password' | 'key' }; onClose: () => void; onSaved: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open) return;
    setHost(existing?.host || node?.ip || ''); setPort(String(existing?.port || 22));
    setUsername(existing?.username || 'root'); setAuthType(existing?.auth_type || 'password');
    setSecret(''); setPassphrase(''); setMsg('');
  }, [open, node, existing]);
  if (!open || !node) return null;
  const save = async () => {
    if (!host.trim() || !username.trim()) { setMsg(tt('Host und Benutzer erforderlich.')); return; }
    if (!existing && !secret.trim()) { setMsg(authType === 'key' ? tt('Privaten Schlüssel einfügen.') : tt('Passwort eingeben.')); return; }
    setBusy(true); setMsg('');
    try {
      await api.ssh.save({ nodeId: node.id, host: host.trim(), port: Number(port) || 22, username: username.trim(), authType,
        password: authType === 'password' ? (secret || undefined) : undefined,
        privateKey: authType === 'key' ? (secret || undefined) : undefined,
        passphrase: passphrase || undefined, label: node.label });
      onSaved(); onClose();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={tt('SSH-Zugang: {x}', { x: node.label })} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>{busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null} {tt('Speichern')}</button>
      </>}>
      {msg && <div className="login-error">{msg}</div>}
      <div className="form-row">
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Host/IP</label>
          <input className="input input--rect" value={host} onChange={(e) => setHost(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Port</label>
          <input className="input input--rect" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Benutzer')}</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Anmeldung')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className={`btn btn--sm ${authType === 'password' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setAuthType('password')}>{tt('Passwort')}</button>
          <button type="button" className={`btn btn--sm ${authType === 'key' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setAuthType('key')}>{tt('SSH-Schlüssel')}</button>
        </div>
      </div>
      {authType === 'password' ? (
        <div className="form-group">
          <label className="form-label">{tt('Passwort')} {existing ? tt('(leer = unverändert)') : ''}</label>
          <input className="input input--rect" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
        </div>
      ) : (
        <>
          <div className="form-group">
            <label className="form-label">{tt('Privater Schlüssel')} {existing ? tt('(leer = unverändert)') : ''}</label>
            <textarea className="input input--rect" rows={4} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
          </div>
          <div className="form-group">
            <label className="form-label">{tt('Passphrase')} {tt('(optional)')}</label>
            <input className="input input--rect" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
          </div>
        </>
      )}
      <div className="form-hint">{tt('Zugangsdaten werden verschlüsselt (AES-256-GCM) gespeichert. Beim Test verbindet sich das System per SSH und prüft von diesem Gerät aus.')}</div>
    </Modal>
  );
}

// Formular-Fenster für eigene Zonen (Tunnel-Einstieg, Gerät/Router, LAN/Internet)
function ZoneModal({ open, zone, dockerNames, onClose, onSave }: { open: boolean; zone?: CZone; dockerNames: string[]; onClose: () => void; onSave: (z: CZone, existing?: CZone) => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<NonNullable<CZone['type']>>('tunnel');
  const [container, setContainer] = useState('');
  const [cidr, setCidr] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabel(zone?.label || ''); setType(zone?.type || 'tunnel');
    setContainer(zone?.container || ''); setCidr(zone?.cidr || '');
  }, [open, zone]);
  if (!open) return null;
  const typeLabel = type === 'lan' ? 'LAN' : type === 'internet' ? tt('Internet') : type === 'device' ? tt('Gerät') : tt('Tunnel');
  const save = () => {
    if (!label.trim()) return;
    const c = type === 'tunnel' ? (container.trim() || undefined) : undefined;
    const ip = (type === 'tunnel' && c) ? undefined : (cidr.trim() || undefined);
    const sub = type === 'tunnel'
      ? (c ? `${tt('Tunnel')} · ${c}` : (ip ? `${tt('Tunnel')} · ${ip}` : tt('Tunnel')))
      : (ip ? `${typeLabel} · ${ip}` : typeLabel);
    onSave({ id: zone?.id || `czone:${Date.now()}`, label: label.trim(), type, container: c, cidr: ip, sub }, zone);
    onClose();
  };
  return (
    <Modal open={open} title={zone ? tt('Zone bearbeiten') : tt('Zone hinzufügen')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={!label.trim()}>{tt('Speichern')}</button>
      </>}>
      <div className="form-group">
        <label className="form-label">{tt('Name')}</label>
        <input className="input input--rect" autoFocus placeholder={tt('z. B. Gäste-WLAN, VPN, Standort B')} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Art')}</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['tunnel', tt('Tunnel')], ['lan', 'LAN'], ['internet', tt('Internet')], ['device', tt('Gerät/Router')]] as const).map(([v, l]) => (
            <button key={v} type="button" className={`btn btn--sm ${type === v ? 'btn--primary' : 'btn--outline'}`} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
      </div>
      {type === 'tunnel' ? (
        <>
          <div className="form-group">
            <label className="form-label">{tt('Lokaler Tunnel-Container')}</label>
            <select className="input input--rect" value={container} onChange={(e) => setContainer(e.target.value)}>
              <option value="">{tt('— externer/automatischer Einstieg —')}</option>
              {dockerNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="form-hint">{tt('z. B. newt oder cloudflared. Gebunden = echter Test aus diesem Container heraus.')}</div>
          </div>
          {!container && (
            <div className="form-group">
              <label className="form-label">{tt('Externer Einstieg – IP/Host (optional)')}</label>
              <input className="input input--rect" placeholder="192.168.2.50" value={cidr} onChange={(e) => setCidr(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
              <div className="form-hint">{tt('Ein extra Gerät, eine feste IP oder die Router-IP. Ohne lokalen Container nur bis zum veröffentlichten Port prüfbar.')}</div>
            </div>
          )}
        </>
      ) : (
        <div className="form-group">
          <label className="form-label">IP/CIDR {tt('(optional)')}</label>
          <input className="input input--rect" placeholder="10.8.0.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">{tt('Wird als Quelle für Simulation und Firewall-Regeln genutzt.')}</div>
        </div>
      )}
    </Modal>
  );
}
const NODE_W = 190, NODE_H = 58;

function FirewallStudio({ networks, containers, onChanged }: { networks: DockerNetwork[]; containers: Container[]; onChanged?: () => void }) {
  const { prefs, setPref } = usePrefs();
  const layout = (prefs.fwStudio as {
    nodes?: Record<string, { x: number; y: number }>;
    sub?: string;
    zones?: { id: string; label: string; sub?: string; cidr?: string; type?: 'lan' | 'internet' | 'tunnel' | 'device'; container?: string }[];
    hosts?: CHost[];
    assign?: Record<string, string>;
  }) || {};
  const saved = layout.nodes || {};
  const customZones = layout.zones || [];
  const extHosts = layout.hosts || [];
  const assign = layout.assign || {};
  const [sub, setSub] = useState<'map' | 'matrix'>(layout.sub === 'matrix' ? 'matrix' : 'map');
  const [vms, setVms] = useState<VM[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [zoneEdit, setZoneEdit] = useState<{ open: boolean; zone?: CZone }>({ open: false });
  const [hostEdit, setHostEdit] = useState<{ open: boolean; host?: CHost }>({ open: false });
  const [sshEdit, setSshEdit] = useState<{ open: boolean; node: StudioNode | null }>({ open: false, node: null });
  const [sshTargets, setSshTargets] = useState<{ node_id: string; host: string; port: number; username: string; auth_type: 'password' | 'key'; label?: string }[]>([]);
  const [sshMsg, setSshMsg] = useState<Record<string, string>>({});
  const [hostIp, setHostIp] = useState(''); // echte Host-LAN-IP (für veröffentlichte Ports mit 0.0.0.0-Bind)
  const loadSsh = () => { api.ssh.list().then((r) => setSshTargets(r.targets || [])).catch(() => {}); };
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  // gx/gy = Greif-Offset innerhalb des Knotens; cl/ct = Canvas-Ursprung beim Greifen
  const drag = useRef<{ id: string; gx: number; gy: number; cl: number; ct: number; moved: boolean } | null>(null);
  // Regel-Formular (Phase B – sichere ufw-Ebene)
  const [rPort, setRPort] = useState('');
  const [rSrc, setRSrc] = useState<'lan' | 'internet' | 'ip'>('lan');
  const [rIp, setRIp] = useState('');
  const [rAct, setRAct] = useState<'allow' | 'deny'>('allow');
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState('');
  // Verbinden zweier Container (Docker-Netz-Trennung)
  const [linkTo, setLinkTo] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');
  // ufw-Regeln (für Simulation)
  const [fwRules, setFwRules] = useState<FirewallRule[]>([]);
  const [fwActive, setFwActive] = useState(false);
  // Simulation
  const [simSrc, setSimSrc] = useState<string>('internet');
  const [simIp, setSimIp] = useState('');
  const [simTarget, setSimTarget] = useState('');
  const [simPort, setSimPort] = useState('');
  const [simBusy, setSimBusy] = useState(false);
  const [simAddr, setSimAddr] = useState(''); // optionale Ziel-Adresse (überschreibt Ziel-IP)
  type Hop = { label: string; ok: boolean | null; note?: string };
  const [chk, setChk] = useState<null | { reachable: boolean; ports: number[]; error?: string; local?: boolean; hops?: Hop[]; reason?: string; fixable?: boolean; fixKind?: 'ufw' | 'link'; linkPair?: [string, string]; addr: string; src: string; target: string }>(null);
  const [chkBusy, setChkBusy] = useState(false);
  const [chkProg, setChkProg] = useState<{ done: number; total: number } | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  // Hintergrund-Scans (Stapelverarbeitung)
  const [jobs, setJobs] = useState<NetscanJob[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const loadJobs = () => api.netscan.list().then((r) => setJobs(r.jobs || [])).catch(() => {});
  // Routing-Tabelle (Diagnose)
  const [routeData, setRouteData] = useState<{ routes: string[]; addrs: string[] } | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);

  useEffect(() => {
    api.vms.list().then((r) => setVms(r.vms || [])).catch(() => {});
    api.firewall.list().then((r) => { setFwRules(r.rules || []); setFwActive(!!r.active); }).catch(() => {});
    api.ssh.list().then((r) => setSshTargets(r.targets || [])).catch(() => {});
    api.networks.interfaces().then((r) => {
      const lan = (r.interfaces || []).map((i) => i.ip4).find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(ip || ''));
      if (lan) setHostIp(lan);
    }).catch(() => {});
    loadJobs();
  }, [networks]);
  // Beim Wechsel des ausgewählten Knotens das Formular zurücksetzen
  useEffect(() => { setRPort(''); setRSrc('lan'); setRIp(''); setRAct('allow'); setRMsg(''); setLinkTo(''); setLinkMsg(''); }, [sel]);
  // Hintergrund-Scans pollen, solange welche laufen oder das Panel offen ist
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!jobsOpen && !active) return;
    const iv = setInterval(loadJobs, 2500);
    return () => clearInterval(iv);
  }, [jobsOpen, jobs]);

  const doLink = async (a: string, b: string, connect: boolean) => {
    if (!b) { setLinkMsg(tt('Bitte einen Ziel-Container wählen.')); return; }
    setLinkBusy(true); setLinkMsg('');
    try {
      if (connect) { await api.networks.link(a, b); setLinkMsg(tt('Verbunden – beide teilen jetzt ein eigenes Netz.')); }
      else { await api.networks.unlink(a, b); setLinkMsg(tt('Verbindung getrennt.')); }
      onChanged?.();
    } catch (e) { setLinkMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setLinkBusy(false); }
  };

  const LAN_RANGES = '192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12';
  const addRule = async (defaultPort: string) => {
    const port = (rPort || defaultPort).replace(/[^0-9]/g, '');
    if (!port) { setRMsg(tt('Bitte einen Port angeben.')); return; }
    if (rSrc === 'ip' && !/^\d{1,3}(\.\d{1,3}){3}(\/\d+)?$/.test(rIp.trim())) { setRMsg(tt('Bitte eine gültige IP/CIDR angeben.')); return; }
    const from = rSrc === 'lan' ? LAN_RANGES : rSrc === 'ip' ? rIp.trim() : undefined;
    setRBusy(true); setRMsg('');
    try {
      await api.firewall.add({ action: rAct, port, proto: 'tcp', from });
      setRMsg(tt('Regel angelegt.') + (from ? '' : ' ' + tt('(von überall – auch Internet!)')));
    } catch (e) {
      setRMsg(e instanceof Error ? e.message : 'Fehler');
    } finally { setRBusy(false); }
  };

  // ── Modell aufbauen ──
  const membership = new Map<string, { net: string; driver: string; internal: boolean; ip: string }[]>();
  for (const n of networks) {
    if (n.name === 'none') continue;
    for (const c of n.containers) {
      if (!membership.has(c.name)) membership.set(c.name, []);
      membership.get(c.name)!.push({ net: n.name, driver: n.driver, internal: n.internal, ip: (c.ipv4 || '').replace(/\/\d+$/, '') });
    }
  }
  // Veröffentlichte Ports MIT Host-Bind-Adresse erfassen (z. B. 192.168.178.170:8000).
  // So kennen wir die WIRKLICH erreichbare Adresse (Host-LAN-IP), nicht nur die
  // interne Docker-IP wie 172.18.0.3 (die man aus dem LAN gar nicht aufrufen kann).
  const pubByName = new Map<string, string[]>();
  const pubAddrByName = new Map<string, { ip: string; port: string }[]>();
  let hostLanIp = '';
  const isRealIp = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !/^0\.0\.0\.0$/.test(ip) && !/^127\./.test(ip);
  for (const c of containers) {
    const addrs: { ip: string; port: string }[] = [];
    for (const p of (c.ports || [])) {
      if (!p.includes('->')) continue;
      const left = p.split('->')[0]; // "192.168.178.170:8000" | "0.0.0.0:8000" | ":::8000"
      const port = left.split(':').pop() || '';
      const ip = left.slice(0, left.lastIndexOf(':'));
      if (!port) continue;
      addrs.push({ ip, port });
      if (isRealIp(ip) && !hostLanIp) hostLanIp = ip;
    }
    if (addrs.length) {
      pubByName.set(c.name, [...new Set(addrs.map((a) => a.port))]);
      pubAddrByName.set(c.name, addrs);
    }
  }
  if (!hostLanIp && hostIp) hostLanIp = hostIp; // Fallback aus den Host-Schnittstellen
  const dockerNames = [...new Set(networks.flatMap((n) => n.name === 'none' ? [] : n.containers.map((c) => c.name)))];
  const tunnel = containers.find((c) => /newt|pangolin|wireguard|tailscale|wg-easy|zerotier/i.test(`${c.name} ${c.image}`));

  // Standard-Bereich (Wolke) je Objekt – lokal = LAN, fremde Objekte laut Definition
  const defZone = (id: string): string => {
    if (id.startsWith('ext:')) return extHosts.find((h) => h.id === id)?.zone || 'internet';
    return 'lan';
  };
  const zoneOf = (id: string): string => assign[id] || defZone(id);

  // Erreichbare Host-Adresse eines Containers (Host-LAN-IP, sofern Ports veröffentlicht)
  const reachOf = (name: string): string | undefined => {
    const pa = pubAddrByName.get(name);
    if (!pa) return undefined;
    return pa.find((a) => isRealIp(a.ip))?.ip || (hostLanIp || undefined);
  };
  const nodes: StudioNode[] = [
    { id: 'host', kind: 'host' as const, label: 'Host', sub: tt('Server'), ip: hostLanIp || undefined, reach: hostLanIp || undefined },
    ...dockerNames.map((name) => {
      const m = membership.get(name) || [];
      const ip = m.find((x) => x.driver === 'macvlan' || x.driver === 'ipvlan')?.ip || m[0]?.ip;
      return { id: `docker:${name}`, kind: 'docker' as const, label: name, ip, reach: reachOf(name), ports: pubByName.get(name), nets: m.map((x) => ({ net: x.net, driver: x.driver })) };
    }),
    ...vms.map((v) => ({ id: `vm:${v.id}`, kind: 'vm' as const, label: v.name, sub: v.state })),
    ...extHosts.map((h) => ({ id: h.id, kind: 'ext' as const, label: h.name, ip: h.ip, sub: h.note || (h.type === 'vps' ? 'VPS' : h.type === 'pc' ? tt('PC/Gerät') : tt('Server')) })),
  ].map((n) => ({ ...n, zone: zoneOf(n.id) }));

  // Wolken (Bereiche): Internet, LAN + eigene Zonen – Objekte liegen darin
  const cloudDefs: { key: string; label: string; color: string }[] = [
    { key: 'internet', label: tt('Internet'), color: 'var(--color-warning)' },
    { key: 'lan', label: 'LAN', color: 'var(--color-success)' },
    ...customZones.map((z) => ({ key: z.id, label: z.label, color: 'var(--color-info, #3b82f6)' })),
  ];
  const saveHost = (h: CHost, existing?: CHost) => {
    setPref('fwStudio', { ...layout, hosts: existing ? extHosts.map((x) => x.id === existing.id ? h : x) : [...extHosts, h] });
  };
  const removeHost = (id: string) => {
    setPref('fwStudio', { ...layout, hosts: extHosts.filter((x) => x.id !== id) });
    setSel((s) => (s === id ? null : s));
  };
  const setNodeZone = (id: string, zone: string) => setPref('fwStudio', { ...layout, assign: { ...assign, [id]: zone } });
  const saveZone = (z: CZone, existing?: CZone) => {
    setPref('fwStudio', { ...layout, zones: existing ? customZones.map((x) => x.id === existing.id ? z : x) : [...customZones, z] });
  };
  const addZone = () => setZoneEdit({ open: true });
  const renameZone = (id: string) => { const z = customZones.find((x) => x.id === id); if (z) setZoneEdit({ open: true, zone: z }); };
  const removeZone = (id: string) => {
    setPref('fwStudio', { ...layout, zones: customZones.filter((x) => x.id !== id) });
    setSel((s) => (s === id ? null : s));
  };

  // Standard-Layout, falls keine gespeicherte Position:
  // fremde Objekte oben (Internet-Reihe), lokale unten (LAN-Reihe)
  const CLOUD_PAD = 26, CLOUD_TOP = 30;
  const defPos = (id: string, i: number): { x: number; y: number } => {
    if (id.startsWith('ext:')) return { x: 60 + (i % 4) * 210, y: CLOUD_TOP + 20 };
    if (id === 'host') return { x: 60, y: 260 };
    const k = i; // dockers/vms in der LAN-Reihe
    return { x: 60 + (k % 4) * 210, y: 260 + Math.floor(k / 4) * 90 };
  };
  let gi = 0, ei = 0;
  const sane = (p?: { x: number; y: number }) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 4000 && p.y >= 0 && p.y <= 4000 ? p : undefined;
  const posOf = (id: string): { x: number; y: number } => {
    const l = sane(live[id]); if (l) return l;
    const s = sane(saved[id]); if (s) return s;
    if (id.startsWith('ext:')) return defPos(id, ei++);
    const isGrid = id.startsWith('docker:') || id.startsWith('vm:');
    return defPos(id, isGrid ? gi++ : 0);
  };
  // gi/ei müssen deterministisch sein → Positionen vorab berechnen
  const positions: Record<string, { x: number; y: number }> = {};
  gi = 0; ei = 0;
  for (const n of nodes) positions[n.id] = posOf(n.id);

  // Wolken-Rechtecke aus den Positionen der Mitglieder (auto-umschließend)
  const cloudRects = cloudDefs.map((c) => {
    const members = nodes.filter((n) => n.zone === c.key);
    if (members.length === 0) {
      // leere Wolke an Standardstelle, damit man Objekte zuweisen kann
      const idx = cloudDefs.findIndex((d) => d.key === c.key);
      return { ...c, x: 20, y: 10 + idx * 130, w: 320, h: 110, empty: true };
    }
    const xs = members.map((n) => positions[n.id].x), ys = members.map((n) => positions[n.id].y);
    const x = Math.min(...xs) - CLOUD_PAD, y = Math.min(...ys) - CLOUD_PAD - CLOUD_TOP;
    const w = Math.max(...xs) + NODE_W + CLOUD_PAD - x, h = Math.max(...ys) + NODE_H + CLOUD_PAD - y;
    return { ...c, x: Math.max(0, x), y: Math.max(0, y), w, h, empty: false };
  });
  const cloudRectOf = (key: string) => cloudRects.find((c) => c.key === key);

  // „Maschine": umschließt den Host + die Container, die auf ihm laufen (gleiche Zone).
  // Zeigt sichtbar, dass die Docker AUF dem Host laufen (nicht eigenständige Rechner).
  const hostNode = nodes.find((n) => n.id === 'host');
  const machineMembers = hostNode ? nodes.filter((n) => n.id === 'host' || (n.kind === 'docker' && n.zone === hostNode.zone)) : [];
  const machineRect = machineMembers.length > 1 ? (() => {
    const M = 14, TOP = 22;
    const xs = machineMembers.map((n) => positions[n.id].x), ys = machineMembers.map((n) => positions[n.id].y);
    const x = Math.min(...xs) - M, y = Math.min(...ys) - M - TOP;
    return { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(...xs) + NODE_W + M - x, h: Math.max(...ys) + NODE_H + M - y };
  })() : null;

  // ── Erreichbarkeits-Kanten (mit Label & optionalem Link-Paar zum Trennen) ──
  type Edge = { a: string; b: string; label?: string; link?: [string, string] };
  const edges: Edge[] = [];
  const sharesNet = (a: string, b: string) => {
    const ma = membership.get(a) || [], mb = membership.get(b) || [];
    return ma.some((x) => mb.some((y) => y.net === x.net));
  };
  // gemeinsames cl-* Link-Netz (vom Studio gebaut) → trennbar
  const sharedLink = (a: string, b: string) => {
    const ma = membership.get(a) || [], mb = membership.get(b) || [];
    return ma.some((x) => x.net.startsWith('cl-') && mb.some((y) => y.net === x.net));
  };
  const portLabel = (name: string) => { const p = pubByName.get(name) || []; return p.length ? p.slice(0, 3).join(', ') + (p.length > 3 ? '…' : '') : undefined; };
  for (const name of dockerNames) {
    const hostReach = (membership.get(name) || []).some((x) => x.driver === 'host' || (x.driver === 'bridge' && !x.internal)) || (pubByName.get(name)?.length ?? 0) > 0;
    if (hostReach) edges.push({ a: 'host', b: `docker:${name}`, label: portLabel(name) });
  }
  for (let i = 0; i < dockerNames.length; i++)
    for (let j = i + 1; j < dockerNames.length; j++)
      if (sharesNet(dockerNames[i], dockerNames[j])) {
        const isLink = sharedLink(dockerNames[i], dockerNames[j]);
        edges.push({ a: `docker:${dockerNames[i]}`, b: `docker:${dockerNames[j]}`, link: isLink ? [dockerNames[i], dockerNames[j]] : undefined });
      }

  // ── Drag ──
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      drag.current.moved = true;
      const d = drag.current;
      // Position relativ zum Canvas, abzüglich Greif-Offset
      setLive((l) => ({ ...l, [d.id]: { x: Math.max(0, (e.clientX - d.cl) - d.gx), y: Math.max(0, (e.clientY - d.ct) - d.gy) } }));
    };
    const up = () => {
      if (drag.current && drag.current.moved) {
        const id = drag.current.id;
        setLive((l) => {
          const p = l[id];
          if (p) setPref('fwStudio', { ...layout, nodes: { ...saved, [id]: p } });
          return l;
        });
      }
      drag.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [layout, saved, setPref]);

  const onDown = (e: React.MouseEvent, id: string) => {
    const p = positions[id];
    const c = canvasRef.current?.getBoundingClientRect();
    if (!c) return;
    // Greif-Offset = wo im Knoten gepackt wurde (Canvas-Koordinaten minus Knoten-Position)
    drag.current = { id, cl: c.left, ct: c.top, gx: (e.clientX - c.left) - p.x, gy: (e.clientY - c.top) - p.y, moved: false };
  };
  const onClickNode = (id: string) => { if (!drag.current?.moved) setSel((s) => (s === id ? null : id)); };

  const NODE_COLOR: Record<StudioNode['kind'], string> = {
    host: 'var(--color-accent)', zone: 'var(--color-warning)', docker: 'var(--color-info, #3b82f6)', vm: '#a855f7', ext: '#f97316',
  };
  const NODE_ICON: Record<StudioNode['kind'], React.ElementType> = { host: Server, zone: Globe, docker: Box, vm: MonitorPlay, ext: Globe };

  const maxY = Math.max(360, ...cloudRects.map((c) => c.y + c.h + 30), ...nodes.map((n) => positions[n.id].y + NODE_H + 40));
  const maxX = Math.max(760, ...cloudRects.map((c) => c.x + c.w + 30), ...nodes.map((n) => positions[n.id].x + NODE_W + 40));
  const selNode = nodes.find((n) => n.id === sel) || null;

  // Aktive Studio-Verbindungen (cl-* Paar-Netze) eines Containers
  const linksOf = (name: string) => networks
    .filter((n) => n.name.startsWith('cl-') && n.containers.some((c) => c.name === name))
    .map((n) => ({ net: n.name, partner: n.containers.find((c) => c.name !== name)?.name || '?' }));

  // ── Simulation: kann „von Quelle auf Ziel:Port" verbunden werden? ──
  const rulePortOf = (to: string) => (to.match(/^(\d+)/) || [])[1];
  const targetName = (n: StudioNode | null) => n && n.id.startsWith('docker:') ? n.id.slice('docker:'.length) : null;
  const czoneOf = (s: string) => customZones.find((z) => z.id === s) || null;
  // Ist die Quelle ein Tunnel-Einstieg? (eingebauter Auto-Tunnel oder eigene Zone vom Typ tunnel)
  const isTunnelSrc = () => simSrc === 'tunnel' || czoneOf(simSrc)?.type === 'tunnel';
  // Welcher lokale Container ist der Tunnel-Einstieg? (null = externer/unbekannter Einstieg)
  const tunnelEntry = () => simSrc === 'tunnel' ? (tunnel?.name || null) : (czoneOf(simSrc)?.container || (czoneOf(simSrc)?.type === 'tunnel' ? (tunnel?.name || null) : null));
  // SSH-Quelle: ist simSrc ein fremdes Objekt mit hinterlegtem SSH-Zugang?
  const sshTarget = () => sshTargets.find((s) => s.node_id === simSrc) || null;
  // Container-Quelle: Docker-Knoten direkt ODER Tunnel-Einstieg → getestet per docker exec
  const srcContainer = () => {
    if (simSrc.startsWith('docker:')) return simSrc.slice('docker:'.length);
    if (isTunnelSrc()) return tunnelEntry();
    return null;
  };
  // Aus welcher Perspektive wird wirklich gemessen? (ehrliche Angabe)
  const isLocalVantage = () => !sshTarget() && !srcContainer();
  const vantageLabel = () => {
    const st = sshTarget();
    if (st) return tt('echt vom Gerät {x} aus', { x: `${st.username}@${st.host}` });
    const c = srcContainer();
    if (c) return tt('aus dem Container {x} heraus', { x: c });
    return tt('vom Server/Host selbst (lokale Sicht – Router/Firewall von außen NICHT berücksichtigt)');
  };
  const srcLabel = () => {
    if (simSrc === 'internet') return tt('Internet');
    if (simSrc === 'lan') return 'LAN';
    if (simSrc === 'tunnel') return `${tt('Tunnel')} (${tunnel?.name || '?'})`;
    if (simSrc === 'ip') return simIp.trim() || 'IP';
    const n = nodes.find((x) => x.id === simSrc);
    if (n) return n.label;
    return czoneOf(simSrc)?.label || tt('Zone');
  };
  // Ziel-Adresse, die von der Quelle aus wirklich zählt.
  const targetAddr = (target: StudioNode): string => {
    if (simAddr.trim()) return simAddr.trim();
    const c = srcContainer();
    const tn = targetName(target);
    // Container → Container im selben Docker-Netz: interne IP zählt
    if (c && tn && (c === tn || sharesNet(c, tn))) return target.ip || target.reach || '127.0.0.1';
    // sonst über die veröffentlichte Host-Adresse (LAN-IP)
    if (target.reach) return target.reach;
    if (target.kind === 'host') return hostLanIp || '127.0.0.1';
    return target.ip || '127.0.0.1';
  };
  // Führt einen Scan der Portliste von der gewählten Quelle aus durch.
  const scanFrom = async (addr: string, ports: number[]): Promise<number[]> => {
    const st = sshTarget();
    if (st) return (await api.ssh.scan(simSrc, addr, ports)).open || [];
    const c = srcContainer();
    if (c) return (await api.networks.scanExec(c, addr, ports)).open || [];
    return (await api.networks.scan(addr, ports)).open || [];
  };
  const DEFAULT_PORTS = [22, 21, 25, 53, 80, 81, 143, 443, 445, 587, 993, 1194, 1880, 2049, 3000, 3001, 3306, 4000, 5000, 5432, 5678, 5900, 6379, 7878, 8000, 8006, 8080, 8081, 8090, 8096, 8123, 8443, 8880, 8989, 9000, 9090, 9091, 9443, 11434, 19999, 27017, 32400, 51820, 61208];
  // Heuristik nur für Fix-Vorschlag + Pfad-Erklärung, wenn nicht erreichbar.
  const heuristicFix = (target: StudioNode): { hops: Hop[]; fixable: boolean; fixKind?: 'ufw' | 'link'; linkPair?: [string, string]; reason?: string } => {
    const tn = targetName(target);
    const c = srcContainer();
    const hops: Hop[] = [{ label: srcLabel(), ok: true }];
    if (c && tn) {
      const shared = c === tn || sharesNet(c, tn);
      hops.push({ label: `${tt('Docker-Netz')} → ${target.label}`, ok: shared, note: shared ? tt('Gemeinsames Docker-Netz vorhanden.') : tt('Kein gemeinsames Docker-Netz.') });
      if (!shared) return { hops, fixable: true, fixKind: 'link', linkPair: [c, tn], reason: tt('{a} und {b} teilen kein Docker-Netz – verbinden.', { a: c, b: target.label }) };
      return { hops, fixable: false };
    }
    const port = simPort.replace(/[^0-9]/g, '');
    hops.push({ label: target.label, ok: null });
    if (fwActive && port) {
      const denied = fwRules.some((r) => rulePortOf(r.to) === port && (r.action === 'DENY' || r.action === 'REJECT'));
      const allowed = fwRules.some((r) => rulePortOf(r.to) === port && (r.action === 'ALLOW' || r.action === 'LIMIT'));
      if (denied) return { hops, fixable: true, fixKind: 'ufw', reason: tt('Durch Firewall blockiert (deny-Regel).') };
      if (!allowed) return { hops, fixable: true, fixKind: 'ufw', reason: tt('Keine Freigabe – Standard blockiert (default deny).') };
    }
    return { hops, fixable: false };
  };
  // EIN Test: „erreicht die Quelle das Ziel – und auf welchen Ports?"
  const runCheck = async () => {
    const external = simTarget === '__ext__';
    const target = external ? null : nodes.find((n) => n.id === simTarget);
    if (!external && !target) { setChk({ reachable: false, ports: [], error: tt('Bitte ein Ziel wählen.'), addr: '', src: simSrc, target: '' }); return; }
    // Externes Ziel (Internet/andere Adresse): braucht eine Adresse
    if (external && !simAddr.trim()) {
      setChk({ reachable: false, ports: [], error: tt('Bitte oben eine Ziel-Adresse (IP oder Hostname) angeben – z. B. 1.1.1.1 oder example.com.'), addr: '', src: simSrc, target: simTarget });
      return;
    }
    // „Internet" als QUELLE ohne externes Gerät ist vom Server aus nicht messbar
    if (simSrc === 'internet' && isLocalVantage()) {
      setChk({ reachable: false, ports: [], error: tt('Aus dem Internet lässt sich das vom Server aus nicht messen – private Adressen (z. B. 172.x) sind von außen ohnehin nicht erreichbar. Wähle ein externes Gerät (VPS) als Quelle und trage als Adresse die öffentliche IP bzw. den Pangolin-/Tunnel-Hostnamen ein.'), addr: '', src: simSrc, target: simTarget });
      return;
    }
    // Gerät als Quelle, aber ohne SSH-Zugang → kann von dort nicht testen
    if (simSrc.startsWith('ext:') && !sshTarget()) {
      setChk({ reachable: false, ports: [], error: tt('Für dieses Gerät ist kein SSH-Zugang hinterlegt – im Objekt-Inspector einrichten, dann kann von dort getestet werden.'), addr: '', src: simSrc, target: simTarget });
      return;
    }
    const addr = external ? simAddr.trim() : targetAddr(target!);
    const single = simPort.replace(/[^0-9]/g, '');
    // Auch die in der Firewall freigegebenen Ports mitscannen (z. B. 11434 Ollama),
    // damit „ist das offen?" auch selbst definierte Dienste erfasst.
    const fwPorts = fwRules.map((r) => Number(rulePortOf(r.to))).filter((p) => p >= 1 && p <= 65535);
    const portList = single
      ? [Number(single)]
      : [...new Set([...(target?.ports || []).map(Number), ...fwPorts, ...DEFAULT_PORTS])].filter((p) => p >= 1 && p <= 65535);
    setChkBusy(true); setChk(null); setChkProg({ done: 0, total: portList.length });
    const open: number[] = [];
    try {
      const CHUNK = 8;
      for (let i = 0; i < portList.length; i += CHUNK) {
        const slice = portList.slice(i, i + CHUNK);
        const r = await scanFrom(addr, slice);
        for (const p of r) if (!open.includes(p)) open.push(p);
        setChkProg({ done: Math.min(i + CHUNK, portList.length), total: portList.length });
      }
      open.sort((a, b) => a - b);
      const reachable = open.length > 0;
      const h = (reachable || external || !target) ? null : heuristicFix(target);
      setChk({ reachable, ports: open, local: isLocalVantage(), addr, src: simSrc, target: simTarget, hops: h?.hops, reason: h?.reason, fixable: h?.fixable, fixKind: h?.fixKind, linkPair: h?.linkPair });
    } catch (e) {
      setChk({ reachable: false, ports: [], error: e instanceof Error ? e.message : 'Fehler', addr, src: simSrc, target: simTarget });
    } finally {
      setChkBusy(false); setChkProg(null);
    }
  };
  // Quelle/Ziel für einen (Hintergrund-)Scan auflösen – gleiche Regeln wie runCheck.
  const resolveScan = (): { via: 'local' | 'exec' | 'ssh'; container?: string; nodeId?: string; host: string; label: string } | { error: string } => {
    const external = simTarget === '__ext__';
    const target = external ? null : nodes.find((n) => n.id === simTarget);
    if (!external && !target) return { error: tt('Bitte ein Ziel wählen.') };
    if (external && !simAddr.trim()) return { error: tt('Bitte oben eine Ziel-Adresse (IP oder Hostname) angeben – z. B. 1.1.1.1 oder example.com.') };
    if (simSrc === 'internet' && isLocalVantage()) return { error: tt('Aus dem Internet lässt sich das vom Server aus nicht messen – private Adressen (z. B. 172.x) sind von außen ohnehin nicht erreichbar. Wähle ein externes Gerät (VPS) als Quelle und trage als Adresse die öffentliche IP bzw. den Pangolin-/Tunnel-Hostnamen ein.') };
    if (simSrc.startsWith('ext:') && !sshTarget()) return { error: tt('Für dieses Gerät ist kein SSH-Zugang hinterlegt – im Objekt-Inspector einrichten, dann kann von dort getestet werden.') };
    const host = external ? simAddr.trim() : targetAddr(target!);
    const st = sshTarget();
    const c = srcContainer();
    const via: 'local' | 'exec' | 'ssh' = st ? 'ssh' : c ? 'exec' : 'local';
    const label = `${srcLabel()} → ${external ? tt('externe Adresse') : target!.label} (${host})`;
    return { via, container: c || undefined, nodeId: st ? simSrc : undefined, host, label };
  };
  // Voll-/Hintergrund-Scan als Stapel-Job anlegen.
  const runBackground = async () => {
    const r = resolveScan();
    if ('error' in r) { setChk({ reachable: false, ports: [], error: r.error, addr: '', src: simSrc, target: simTarget }); return; }
    const single = simPort.replace(/[^0-9]/g, '');
    const body = single ? { ...r, ports: [Number(single)] } : { ...r, from: 1, to: 65535 };
    try { await api.netscan.create(body); setJobsOpen(true); loadJobs(); }
    catch (e) { setChk({ reachable: false, ports: [], error: e instanceof Error ? e.message : 'Fehler', addr: '', src: simSrc, target: simTarget }); }
  };
  const simFix = async () => {
    setSimBusy(true);
    try {
      if (chk?.fixKind === 'link' && chk.linkPair) {
        await api.networks.link(chk.linkPair[0], chk.linkPair[1]);
        setChk({ ...chk, fixable: false, reason: tt('Verbunden – {a} und {b} teilen jetzt ein eigenes Netz. Jetzt erneut prüfen.', { a: chk.linkPair[0], b: chk.linkPair[1] }) });
        onChanged?.();
      } else {
        const port = simPort.replace(/[^0-9]/g, '');
        if (!port) { setSimBusy(false); return; }
        const cz = customZones.find((z) => z.id === simSrc);
        const from = simSrc === 'lan' ? LAN_RANGES : simSrc === 'ip' ? simIp.trim() : (cz?.cidr || undefined);
        await api.firewall.add({ action: 'allow', port, proto: 'tcp', from });
        if (chk) setChk({ ...chk, fixable: false, reason: tt('Freigegeben – Regel erstellt. Jetzt erneut prüfen.') });
        onChanged?.();
      }
    }
    catch (e) { if (chk) setChk({ ...chk, reason: e instanceof Error ? e.message : 'Fehler' }); }
    finally { setSimBusy(false); }
  };
  // Kritische Verwaltungs-Ports NIE automatisch sperren (sonst sperrt man sich aus).
  const CRITICAL_PORTS = ['22', '80', '443'];
  // „Sperren": erstellt Firewall-Deny-Regeln für die offenen Ports (Host-Firewall-Weg).
  const blockCheck = async () => {
    if (!chk) return;
    const single = simPort.replace(/[^0-9]/g, '');
    const requested = single ? [single] : chk.ports.map(String);
    if (!requested.length) return;
    // 22/80/443 herausnehmen – sonst verlierst du SSH/Web-Oberfläche
    const skipped = requested.filter((p) => CRITICAL_PORTS.includes(p));
    const ports = requested.filter((p) => !CRITICAL_PORTS.includes(p));
    if (!ports.length) {
      window.alert(tt('Nur kritische Ports (22 SSH, 80/443 Web) gefunden – die werden zum Schutz NICHT gesperrt, sonst sperrst du dich aus.'));
      return;
    }
    const noteSkip = skipped.length ? tt(' (22/80/443 wurden zum Schutz übersprungen)') : '';
    if (!window.confirm(tt('Diese Ports per Firewall sperren: {ports}?{skip}', { ports: ports.join(', '), skip: noteSkip }))) return;
    const st = sshTarget();
    const from = simSrc === 'lan' ? LAN_RANGES : simSrc === 'ip' ? simIp.trim() : st ? st.host : (customZones.find((z) => z.id === simSrc)?.cidr || undefined);
    setBlockBusy(true);
    try {
      for (const p of ports) await api.firewall.add({ action: 'deny', port: p, proto: 'tcp', from });
      setChk({ ...chk, reachable: false, ports: [], reason: tt('Gesperrt – {n} Port(e) per Firewall blockiert.{skip} Achtung: das wirkt nur auf den Host-Firewall-Weg. Über den Tunnel oder ein gemeinsames Docker-Netz erreichbare Ports musst du dort trennen (Verbindung lösen bzw. Tunnel-/Pangolin-Regel).', { n: String(ports.length), skip: noteSkip }) });
      onChanged?.();
    } catch (e) { setChk({ ...chk, reason: e instanceof Error ? e.message : 'Fehler' }); }
    finally { setBlockBusy(false); }
  };
  const loadRoutes = async () => {
    setRouteBusy(true);
    try { setRouteData(await api.networks.routes()); setShowRoutes(true); }
    catch { setRouteData({ routes: [], addrs: [] }); setShowRoutes(true); }
    finally { setRouteBusy(false); }
  };

  return (
    <Panel title={tt('Firewall-Studio')} icon={<Network size={15} />} storageKey="fw-studio"
      actions={
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn--sm ${sub === 'map' ? 'btn--primary' : 'btn--outline'}`} onClick={() => { setSub('map'); setPref('fwStudio', { ...layout, sub: 'map' }); }}><LayoutGrid size={12} /> {tt('Karte')}</button>
          <button className={`btn btn--sm ${sub === 'matrix' ? 'btn--primary' : 'btn--outline'}`} onClick={() => { setSub('matrix'); setPref('fwStudio', { ...layout, sub: 'matrix' }); }}><Table size={12} /> {tt('Matrix')}</button>
          {sub === 'map' && <button className="btn btn--sm btn--outline" onClick={() => setHostEdit({ open: true })} title={tt('Fremden Server/PC (VPS im Internet, LAN-Rechner) hinzufügen')}><Plus size={12} /> {tt('Server/PC')}</button>}
          {sub === 'map' && <button className="btn btn--sm btn--outline" onClick={addZone} title={tt('Eigene Zone (Tunnel/LAN/Internet) hinzufügen')}><Plus size={12} /> {tt('Zone')}</button>}
        </div>
      }
    >
      {sub === 'matrix' ? (
        <div style={{ marginTop: 8 }}><ConnectivityPanel networks={networks} containers={containers} /></div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', margin: '6px 0 10px' }}>
            {tt('Objekte frei verschieben (gespeichert pro Benutzer). Klick öffnet/schließt die Details. Linien = wer kann wen erreichen.')}
          </div>
          <div style={{ position: 'relative' }}>
          <div style={{ overflow: 'auto', maxHeight: '72vh', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface-sunken)' }}>
          <div ref={canvasRef} style={{ position: 'relative', width: maxX, height: maxY }}>
            {/* Wolken (Bereiche) – hinter den Objekten */}
            {cloudRects.map((c) => (
              <div key={c.key} style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, zIndex: 0,
                border: `1.5px dashed ${c.color}`, borderRadius: 14, background: `color-mix(in srgb, ${c.color} 7%, transparent)`, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: -11, left: 12, padding: '1px 8px', fontSize: 11, fontWeight: 700, color: c.color,
                  background: 'var(--color-surface-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Globe size={11} /> {c.label}{c.empty ? ` · ${tt('leer')}` : ''}
                </div>
              </div>
            ))}
            {/* Maschine: Host + darauf laufende Container */}
            {machineRect && (
              <div style={{ position: 'absolute', left: machineRect.x, top: machineRect.y, width: machineRect.w, height: machineRect.h, zIndex: 0,
                border: '1.5px solid var(--color-accent)', borderRadius: 12, background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: -11, left: 12, padding: '1px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--color-accent)',
                  background: 'var(--color-surface-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Server size={11} /> {tt('Docker-Host (Container laufen hier)')}
                </div>
              </div>
            )}
            {/* Kanten */}
            <svg style={{ position: 'absolute', inset: 0, width: maxX, height: maxY, zIndex: 1, pointerEvents: 'none' }}>
              {/* Tunnel: Internet-Wolke ↔ Tunnel-Container */}
              {tunnel && positions[`docker:${tunnel.name}`] && cloudRectOf('internet') && (() => {
                const ic = cloudRectOf('internet')!; const tp = positions[`docker:${tunnel.name}`];
                const x1 = ic.x + ic.w / 2, y1 = ic.y + ic.h, x2 = tp.x + NODE_W / 2, y2 = tp.y + NODE_H / 2;
                return (<g>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-warning)" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.6} />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-warning)"
                    stroke="var(--color-surface-sunken)" strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke">{tt('Tunnel')}</text>
                </g>);
              })()}
              {/* Direkter Weg: Internet-Wolke ↔ Host (nur mit Router-Portfreigabe erreichbar) */}
              {positions['host'] && cloudRectOf('internet') && (() => {
                const ic = cloudRectOf('internet')!; const hp = positions['host'];
                const x1 = ic.x + ic.w / 2, y1 = ic.y + ic.h, x2 = hp.x + NODE_W / 2, y2 = hp.y + NODE_H / 2;
                return (<g>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-danger)" strokeWidth={1.5} strokeDasharray="2 5" strokeOpacity={0.5} />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--color-danger)"
                    stroke="var(--color-surface-sunken)" strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke">{tt('direkt (nur mit Portfreigabe)')}</text>
                </g>);
              })()}
              {edges.map((ed, i) => {
                const { a, b, label, link } = ed;
                const pa = positions[a], pb = positions[b];
                if (!pa || !pb) return null;
                const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H / 2, x2 = pb.x + NODE_W / 2, y2 = pb.y + NODE_H / 2;
                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                const dim = sel && sel !== a && sel !== b ? 0.12 : 0.4;
                return (
                  <g key={i}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={link ? 'var(--color-success)' : 'var(--color-accent)'} strokeWidth={link ? 2 : 1.5}
                      strokeDasharray={link ? '5 4' : undefined} strokeOpacity={dim} />
                    {link && (
                      <circle cx={mx} cy={my} r={9} fill="var(--color-surface)" stroke="var(--color-success)" strokeWidth={1.5}
                        style={{ pointerEvents: 'all', cursor: 'pointer' }} opacity={dim < 0.2 ? 0.3 : 1}
                        onClick={async () => { if (window.confirm(tt('Verbindung {a} ↔ {b} trennen?', { a: link[0], b: link[1] }))) { try { await api.networks.unlink(link[0], link[1]); onChanged?.(); } catch (e) { alert(e instanceof Error ? e.message : 'Fehler'); } } }}>
                        <title>{tt('Verbindung trennen')}</title>
                      </circle>
                    )}
                    {link && <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-success)" style={{ pointerEvents: 'none' }}>×</text>}
                    {label && !link && (
                      <text x={mx} y={my - 3} textAnchor="middle" fontSize={9.5} fill="var(--color-muted)" opacity={dim < 0.2 ? 0.4 : 0.95}
                        stroke="var(--color-surface-sunken)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: 'none' }}>{label}</text>
                    )}
                  </g>
                );
              })}
            </svg>
            {/* Knoten (nur Box – Details im Inspector rechts) */}
            {nodes.map((n) => {
              const p = positions[n.id];
              const Icon = NODE_ICON[n.kind];
              const isSel = sel === n.id;
              return (
                <div key={n.id} style={{ position: 'absolute', left: p.x, top: p.y, width: NODE_W, zIndex: 2 }}>
                  <div onMouseDown={(e) => onDown(e, n.id)} onClick={() => onClickNode(n.id)}
                    style={{ cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8, height: NODE_H, padding: '0 10px',
                      background: 'var(--color-surface)', border: `1px solid ${isSel ? NODE_COLOR[n.kind] : 'var(--color-border)'}`,
                      borderLeft: `3px solid ${NODE_COLOR[n.kind]}`, borderRadius: 8, boxShadow: isSel ? '0 0 0 2px var(--color-accent-soft)' : 'none' }}>
                    <Icon size={16} style={{ color: NODE_COLOR[n.kind], flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{n.label}</div>
                      <div style={{ fontSize: 10, color: n.reach ? 'var(--color-success)' : 'var(--color-faint)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{n.reach ? `${n.reach}${n.ports && n.ports.length ? ':' + n.ports[0] : ''}` : (n.ip || n.sub || '')}</div>
                      {n.kind === 'docker' && (n.reach || n.nets?.length) && (
                        <div style={{ fontSize: 9, color: 'var(--color-faint)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                          {n.ip ? `${n.ip} · ` : ''}{n.nets?.[0]?.net || ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
            {/* Inspector rechts – immer voll sichtbar (außerhalb des Scroll-Bereichs) */}
            {selNode && (
              <div onMouseDown={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 10, right: 10, width: 250, maxHeight: '68vh', overflowY: 'auto', zIndex: 5,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, fontSize: 11.5, lineHeight: 1.6, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{selNode.label}</span>
                  {selNode.id.startsWith('czone:') && <>
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Zone umbenennen')} onClick={() => renameZone(selNode.id)}><Pencil size={13} /></button>
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Zone entfernen')} onClick={() => removeZone(selNode.id)}><Trash2 size={13} /></button>
                  </>}
                  {selNode.id.startsWith('ext:') && <>
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Objekt bearbeiten')} onClick={() => setHostEdit({ open: true, host: extHosts.find((h) => h.id === selNode.id) })}><Pencil size={13} /></button>
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Objekt entfernen')} onClick={() => removeHost(selNode.id)}><Trash2 size={13} /></button>
                  </>}
                  <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setSel(null)}><X size={13} /></button>
                </div>
                <div><span style={{ color: 'var(--color-faint)' }}>{tt('Typ')}: </span>{selNode.kind}</div>
                {!selNode.id.startsWith('czone:') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <span style={{ color: 'var(--color-faint)' }}>{tt('Bereich')}: </span>
                    <select className="input input--rect" style={{ height: 24, fontSize: 11, flex: 1 }} value={selNode.zone || 'lan'} onChange={(e) => setNodeZone(selNode.id, e.target.value)}>
                      {cloudDefs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                )}
                {(() => { const z = czoneOf(selNode.id); if (!z) return null; return (<>
                  {z.type && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Art')}: </span>{z.type === 'lan' ? 'LAN' : z.type === 'internet' ? tt('Internet') : z.type === 'device' ? tt('Gerät') : tt('Tunnel')}</div>}
                  {z.container && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Tunnel-Container')}: </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{z.container}</span></div>}
                  {z.cidr && <div><span style={{ color: 'var(--color-faint)' }}>IP/CIDR: </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{z.cidr}</span></div>}
                </>); })()}
                {selNode.reach && selNode.ports && selNode.ports.length > 0 && (
                  <div><span style={{ color: 'var(--color-faint)' }}>{tt('Erreichbar über')}: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-success)', fontWeight: 700 }}>{selNode.reach}:{selNode.ports.join('/')}</span>
                  </div>
                )}
                {selNode.ip && <div><span style={{ color: 'var(--color-faint)' }}>{selNode.kind === 'docker' ? tt('Docker-intern') : 'IP'}: </span><span style={{ fontFamily: 'var(--font-mono)', color: selNode.kind === 'docker' ? 'var(--color-faint)' : 'var(--color-accent)' }}>{selNode.ip}{selNode.kind === 'docker' ? ` (${tt('nur intern')})` : ''}</span></div>}
                {selNode.nets && selNode.nets.length > 0 && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Netzwerk')}: </span>{selNode.nets.map((x) => `${x.net} (${x.driver})`).join(', ')}</div>}
                {selNode.ports && selNode.ports.length > 0 && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Ports')}: </span>{selNode.ports.join(', ')}</div>}

                {/* SSH-Zugang für echte Tests von diesem Gerät aus (nur fremde Objekte) */}
                {selNode.kind === 'ext' && (() => {
                  const t = sshTargets.find((s) => s.node_id === selNode.id);
                  return (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Terminal size={12} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 600, flex: 1 }}>{tt('SSH-Zugang')}</span>
                        {t && <span style={{ fontSize: 10, color: 'var(--color-success)' }}>✓ {t.username}@{t.host}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn--outline btn--sm" onClick={() => setSshEdit({ open: true, node: selNode })}>
                          {t ? <Pencil size={12} /> : <Plus size={12} />} {t ? tt('Ändern') : tt('Einrichten')}
                        </button>
                        {t && <button className="btn btn--outline btn--sm" onClick={async () => {
                          setSshMsg((m) => ({ ...m, [selNode.id]: tt('teste…') }));
                          try { const r = await api.ssh.test(selNode.id); setSshMsg((m) => ({ ...m, [selNode.id]: r.ok ? tt('Login OK ({ms} ms)', { ms: String(r.ms) }) : (r.error || tt('Login fehlgeschlagen')) })); }
                          catch (e) { setSshMsg((m) => ({ ...m, [selNode.id]: e instanceof Error ? e.message : 'Fehler' })); }
                        }}><Activity size={12} /> {tt('Login testen')}</button>}
                        {t && <button className="btn btn--ghost btn--icon btn--sm" title={tt('Zugang löschen')} onClick={async () => { if (window.confirm(tt('SSH-Zugang wirklich löschen?'))) { await api.ssh.remove(selNode.id); loadSsh(); setSshMsg((m) => ({ ...m, [selNode.id]: '' })); } }}><Trash2 size={12} /></button>}
                      </div>
                      {sshMsg[selNode.id] && <div style={{ fontSize: 10.5, color: 'var(--color-muted)' }}>{sshMsg[selNode.id]}</div>}
                      <div style={{ fontSize: 10, color: 'var(--color-faint)' }}>{tt('Dann unten dieses Gerät als Quelle wählen – die Prüfung läuft echt von hier aus.')}</div>
                    </div>
                  );
                })()}

                {(selNode.kind === 'host' || (selNode.ports && selNode.ports.length > 0)) && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ fontWeight: 600 }}>{tt('Zugriff regeln')}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(selNode.ports || []).map((p) => (
                        <button key={p} className={`btn btn--sm ${rPort === p ? 'btn--primary' : 'btn--outline'}`} style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => setRPort(p)}>{p}</button>
                      ))}
                      <input className="input input--rect" style={{ width: 70, height: 26, fontSize: 11 }} placeholder={tt('Port')} value={rPort} onChange={(e) => setRPort(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <select className="input input--rect" style={{ height: 26, fontSize: 11, flex: 1, minWidth: 80 }} value={rSrc} onChange={(e) => setRSrc(e.target.value as typeof rSrc)}>
                        <option value="lan">{tt('von LAN')}</option>
                        <option value="internet">{tt('von Internet')}</option>
                        <option value="ip">{tt('von IP')}</option>
                      </select>
                      <select className="input input--rect" style={{ height: 26, fontSize: 11, width: 84 }} value={rAct} onChange={(e) => setRAct(e.target.value as typeof rAct)}>
                        <option value="allow">{tt('erlauben')}</option>
                        <option value="deny">{tt('sperren')}</option>
                      </select>
                    </div>
                    {rSrc === 'ip' && <input className="input input--rect" style={{ height: 26, fontSize: 11, fontFamily: 'var(--font-mono)' }} placeholder="192.168.1.50" value={rIp} onChange={(e) => setRIp(e.target.value)} />}
                    <button className="btn btn--primary btn--sm" disabled={rBusy} onClick={() => addRule((selNode.ports || [])[0] || '')}>
                      {rBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Shield size={12} />} {tt('Regel anlegen')}
                    </button>
                    {rMsg && <div style={{ fontSize: 11, color: rMsg.includes('angelegt') ? 'var(--color-success)' : 'var(--color-warning)' }}>{rMsg}</div>}
                  </div>
                )}

                {selNode.kind === 'docker' && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ fontWeight: 600 }}>{tt('Mit Container verbinden')}</div>
                    {linksOf(selNode.label).length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {linksOf(selNode.label).map((lk) => (
                          <div key={lk.net} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <Link2 size={11} style={{ color: 'var(--color-success)' }} /> <span style={{ flex: 1 }}>{lk.partner}</span>
                            <button className="btn btn--ghost btn--icon btn--sm" title={tt('trennen')} disabled={linkBusy} onClick={() => doLink(selNode.label, lk.partner, false)}><Unlink size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <select className="input input--rect" style={{ height: 26, fontSize: 11, flex: 1, minWidth: 100 }} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                        <option value="">{tt('— Ziel-Container —')}</option>
                        {dockerNames.filter((d) => d !== selNode.label).map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <button className="btn btn--primary btn--sm" disabled={linkBusy || !linkTo} onClick={() => doLink(selNode.label, linkTo, true)}>
                        {linkBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Link2 size={12} />} {tt('verbinden')}
                      </button>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Legt ein eigenes Netz nur für dieses Paar an – nichts anderes wird verändert.')}</div>
                    {linkMsg && <div style={{ fontSize: 11, color: linkMsg.includes('Verbun') || linkMsg.includes('getrennt') ? 'var(--color-success)' : 'var(--color-warning)' }}>{linkMsg}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-faint)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-accent)' }}>● Host</span>
            <span style={{ color: 'var(--color-info, #3b82f6)' }}>● Docker</span>
            <span style={{ color: '#a855f7' }}>● VM</span>
            <span style={{ color: '#f97316' }}>● {tt('Fremder Server/PC')}</span>
            <span style={{ color: 'var(--color-warning)' }}>▢ {tt('Bereich/Wolke (Internet/LAN/Zone)')}</span>
          </div>

          {/* ── Simulation ── */}
          <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{tt('Erreichbarkeit prüfen')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{tt('Von (Quelle)')}</label>
                <select className="input input--rect" style={{ height: 30, fontSize: 12 }} value={simSrc} onChange={(e) => { setSimSrc(e.target.value); setChk(null); }}>
                  <option value="internet">{tt('Internet')}</option>
                  <option value="lan">LAN</option>
                  <option value="ip">{tt('bestimmte IP')}</option>
                  {tunnel && <option value="tunnel">{tt('Tunnel')} ({tunnel.name})</option>}
                  <optgroup label={tt('Objekte (echt von dort)')}>
                    <option value="host">Host</option>
                    {dockerNames.map((d) => <option key={d} value={`docker:${d}`}>{d}</option>)}
                    {extHosts.map((h) => <option key={h.id} value={h.id}>{h.name}{sshTargets.some((s) => s.node_id === h.id) ? ' (SSH)' : ''}</option>)}
                  </optgroup>
                  {customZones.length > 0 && <optgroup label={tt('Zonen')}>{customZones.map((z) => <option key={z.id} value={z.id}>{z.label}{z.cidr ? ` (${z.cidr})` : ''}</option>)}</optgroup>}
                </select>
              </div>
              {simSrc === 'ip' && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>IP</label>
                <input className="input input--rect" style={{ height: 30, fontSize: 12, width: 140, fontFamily: 'var(--font-mono)' }} placeholder="203.0.113.5" value={simIp} onChange={(e) => setSimIp(e.target.value)} />
              </div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{tt('Nach (Ziel)')}</label>
                <select className="input input--rect" style={{ height: 30, fontSize: 12, minWidth: 150 }} value={simTarget} onChange={(e) => { setSimTarget(e.target.value); setChk(null); }}>
                  <option value="">{tt('— wählen —')}</option>
                  <option value="__ext__">🌐 {tt('Internet / externe Adresse')}</option>
                  <optgroup label={tt('Objekte')}>
                    {nodes.filter((n) => (n.kind === 'host' || n.kind === 'docker' || n.kind === 'ext') && n.id !== simSrc).map((n) => <option key={n.id} value={n.id}>{n.label}{n.reach ? ` (${n.reach})` : ''}</option>)}
                  </optgroup>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{tt('Adresse')} {tt('(optional)')}</label>
                <input className="input input--rect" style={{ height: 30, fontSize: 12, width: 150, fontFamily: 'var(--font-mono)' }} placeholder={tt('Ziel-IP/Host')} value={simAddr} onChange={(e) => { setSimAddr(e.target.value); setChk(null); }} title={tt('Überschreibt die Ziel-Adresse – z. B. der Tunnel-/Pangolin-Hostname, über den die Quelle das Ziel erreicht.')} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{tt('Port')} {tt('(optional)')}</label>
                <input className="input input--rect" style={{ height: 30, fontSize: 12, width: 90 }} placeholder={tt('alle')} value={simPort} onChange={(e) => setSimPort(e.target.value)} title={tt('Leer = alle gängigen Ports prüfen. Ausgefüllt = nur diesen Port.')} />
              </div>
              <button className="btn btn--primary btn--sm" disabled={chkBusy || !simTarget} onClick={runCheck}>
                {chkBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Activity size={13} />} {tt('Erreichbarkeit prüfen')}
              </button>
              <button className="btn btn--outline btn--sm" disabled={!simTarget} onClick={runBackground} title={tt('Langer/vollständiger Scan im Hintergrund (Stapel) – Ergebnis erscheint unten als Bericht.')}>
                <Download size={13} /> {tt('Voll-Scan (Hintergrund)')}
              </button>
            </div>
            {/* Fortschritt beim Scannen aller Ports */}
            {chkProg && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 3 }}>{tt('Prüfe Ports … {done}/{total}', { done: String(chkProg.done), total: String(chkProg.total) })}</div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--color-surface-sunken)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${chkProg.total ? Math.round((chkProg.done / chkProg.total) * 100) : 0}%`, background: 'var(--color-accent)', transition: 'width .2s' }} />
                </div>
              </div>
            )}
            {/* EIN klares Ergebnis: erreichbar (+Ports) oder nicht */}
            {chk && !chkBusy && (() => {
              const target = nodes.find((n) => n.id === chk.target);
              const targetLabel = chk.target === '__ext__' ? tt('externe Adresse') : (target?.label || '?');
              const dst = chk.addr || simAddr.trim() || target?.reach || target?.ip || target?.label || '?';
              // Bei externem Ziel ist die lokale Messung (Host → Internet) echt und korrekt,
              // daher kein „nur lokale Sicht"-Vorbehalt.
              const local = !!chk.local && chk.target !== '__ext__';
              const okCol = local ? 'var(--color-warning)' : 'var(--color-success)';
              const okRgb = local ? '234,179,8' : '34,197,94';
              if (chk.error) return (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(234,179,8,.1)', border: '1px solid var(--color-warning)33', fontSize: 12, color: 'var(--color-muted)' }}>{chk.error}</div>
              );
              return (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8,
                  background: chk.reachable ? `rgba(${okRgb},.1)` : 'rgba(239,68,68,.08)', border: `1px solid ${chk.reachable ? okCol : 'var(--color-danger)'}33` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: chk.reachable ? okCol : 'var(--color-danger)' }}>
                      {chk.reachable ? '✓ ' + tt('Erreichbar') : '✕ ' + tt('Nicht erreichbar')}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-muted)', flex: 1 }}>
                      {srcLabel()} → {targetLabel} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-faint)' }}>({dst})</span>
                    </span>
                    {chk.reachable && (
                      <button className="btn btn--outline btn--sm" disabled={blockBusy} onClick={blockCheck} title={tt('Diese Ports per Firewall sperren (Host-Firewall-Weg).')}>
                        {blockBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Lock size={12} />} {tt('Sperren')}
                      </button>
                    )}
                    {!chk.reachable && chk.fixable && (
                      <button className="btn btn--primary btn--sm" disabled={simBusy} onClick={simFix}>
                        {simBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : (chk.fixKind === 'link' ? <Link2 size={12} /> : <Shield size={12} />)} {chk.fixKind === 'link' ? tt('Verbinden') : tt('Freischalten')}
                      </button>
                    )}
                  </div>
                  {chk.reachable && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 4 }}>{tt('Offene Ports (anklicken zum Übernehmen):')}</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {chk.ports.map((p) => (
                          <button key={p} className="btn btn--sm" style={{ padding: '2px 10px', fontSize: 12, fontWeight: 700, color: okCol, border: `1px solid ${okCol}`, background: `rgba(${okRgb},.12)` }}
                            title={tt('Port übernehmen')} onClick={() => setSimPort(String(p))}>{p}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!chk.reachable && chk.reason && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-muted)' }}>{chk.reason}</div>}
                  {!chk.reachable && !chk.reason && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Kein Port erreichbar. Ggf. Adresse prüfen (richtiger Tunnel-/Hostname?).')}</div>}
                  <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Gemessen')}: {vantageLabel()}</div>
                  {local && (
                    <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--color-warning)' }}>
                      ⚠ {tt('Lokale Server-Sicht – für den echten Weg von außen ein Gerät (VPS) als Quelle wählen.')}
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-faint)' }}>{tt('Prüft echt von der Quelle zum Ziel. Port leer = alle gängigen Ports (mit Fortschritt); ausgefüllt = nur dieser. Ziel-Adresse leer = automatisch (Host-LAN-IP bei veröffentlichten Ports).')}</div>
          </div>

          {/* ── Routing-Tabelle (Diagnose: wo hängt es?) ── */}
          <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{tt('Routing-Tabelle')}</div>
              <button className="btn btn--outline btn--sm" disabled={routeBusy} onClick={() => (showRoutes ? setShowRoutes(false) : loadRoutes())}>
                {routeBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <RefreshCw size={13} />} {showRoutes ? tt('Ausblenden') : tt('Anzeigen')}
              </button>
            </div>
            {showRoutes && routeData && (
              <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 3 }}>{tt('Schnittstellen (ip addr)')}</div>
                  <pre style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', overflowX: 'auto', color: 'var(--color-muted)', background: 'var(--color-surface-sunken)', padding: 8, borderRadius: 6 }}>{routeData.addrs.join('\n') || '—'}</pre>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 3 }}>{tt('Routen (ip route)')}</div>
                  <pre style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', overflowX: 'auto', color: 'var(--color-muted)', background: 'var(--color-surface-sunken)', padding: 8, borderRadius: 6 }}>{routeData.routes.join('\n') || '—'}</pre>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Zeigt die Host-Routen & Schnittstellen. docker0/br-* sind die Docker-Bridges – getrennte br-* bedeuten isolierte Container-Netze.')}</div>
              </div>
            )}
          </div>

          {/* ── Hintergrund-Scans (Stapelverarbeitung) ── */}
          <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>
                {tt('Hintergrund-Scans')}{jobs.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-faint)' }}>({jobs.filter((j) => j.status === 'queued' || j.status === 'running').length} {tt('aktiv')} / {jobs.length})</span>}
              </div>
              <button className="btn btn--outline btn--sm" onClick={() => { setJobsOpen(!jobsOpen); if (!jobsOpen) loadJobs(); }}>
                <RefreshCw size={13} /> {jobsOpen ? tt('Ausblenden') : tt('Anzeigen')}
              </button>
            </div>
            {jobsOpen && (
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {jobs.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{tt('Keine Hintergrund-Scans. Starte einen mit „Voll-Scan (Hintergrund)".')}</div>}
                {jobs.map((j) => {
                  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
                  const stCol = j.status === 'done' ? 'var(--color-success)' : j.status === 'error' ? 'var(--color-danger)' : j.status === 'canceled' ? 'var(--color-faint)' : 'var(--color-accent)';
                  const stTxt = j.status === 'queued' ? tt('wartet') : j.status === 'running' ? tt('läuft') : j.status === 'done' ? tt('fertig') : j.status === 'error' ? tt('Fehler') : tt('abgebrochen');
                  return (
                    <div key={j.id} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-sunken)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: stCol }}>{stTxt}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--color-faint)', fontFamily: 'var(--font-mono)' }}>{j.done}/{j.total}</span>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Entfernen/Abbrechen')} onClick={async () => { await api.netscan.remove(j.id); loadJobs(); }}><Trash2 size={12} /></button>
                      </div>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <div style={{ height: 5, borderRadius: 3, background: 'var(--color-surface)', overflow: 'hidden', marginTop: 5 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-accent)', transition: 'width .3s' }} />
                        </div>
                      )}
                      {j.open.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--color-success)', fontWeight: 700 }}>{tt('Offen')}:</span>
                          {j.open.map((p) => <span key={p} style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success)', border: '1px solid var(--color-success)', borderRadius: 5, padding: '1px 7px' }}>{p}</span>)}
                        </div>
                      )}
                      {j.status === 'done' && j.open.length === 0 && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--color-muted)' }}>{tt('Kein offener Port gefunden.')}</div>}
                      {j.error && <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--color-danger)' }}>{j.error}</div>}
                    </div>
                  );
                })}
                <div style={{ fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Jobs laufen nacheinander (Stapel). Ergebnisse bleiben bis zum Neustart erhalten.')}</div>
              </div>
            )}
          </div>
        </>
      )}
      <ZoneModal open={zoneEdit.open} zone={zoneEdit.zone} dockerNames={dockerNames}
        onClose={() => setZoneEdit({ open: false })} onSave={saveZone} />
      <HostModal open={hostEdit.open} host={hostEdit.host} zones={cloudDefs.map((c) => ({ key: c.key, label: c.label }))}
        onClose={() => setHostEdit({ open: false })} onSave={saveHost} />
      <SshModal open={sshEdit.open} node={sshEdit.node} existing={sshEdit.node ? sshTargets.find((s) => s.node_id === sshEdit.node!.id) : undefined}
        onClose={() => setSshEdit({ open: false, node: null })} onSaved={loadSsh} />
    </Panel>
  );
}

// Umschalter: Studio (Standard) ⟷ klassische ufw-Tabelle (pro Benutzer gespeichert)
function FirewallView({ networks, containers, onChanged }: { networks: DockerNetwork[]; containers: Container[]; onChanged?: () => void }) {
  const { prefs, setPref } = usePrefs();
  const mode = (prefs.fwView as 'studio' | 'table') || 'studio';
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`btn btn--sm ${mode === 'studio' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setPref('fwView', 'studio')}>
          <LayoutGrid size={13} /> {tt('Studio')}
        </button>
        <button className={`btn btn--sm ${mode === 'table' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setPref('fwView', 'table')}>
          <Table size={13} /> {tt('ufw-Tabelle')}
        </button>
      </div>
      {mode === 'studio' ? <FirewallStudio networks={networks} containers={containers} onChanged={onChanged} /> : <FirewallPanel />}
    </>
  );
}

type NetTab = 'docker' | 'vm' | 'firewall' | 'karte' | 'connections' | 'vips';

export function Networks() {
  const t = useT();
  const [view, setView] = useState<NetTab>('docker');
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [interfaces, setInterfaces] = useState<HostInterface[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [connectNet, setConnectNet] = useState<DockerNetwork | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [n, i, c] = await Promise.allSettled([api.networks.list(), api.networks.interfaces(), api.containers.list()]);
      if (n.status === 'fulfilled') setNetworks(n.value.networks);
      if (i.status === 'fulfilled') setInterfaces(i.value.interfaces);
      if (c.status === 'fulfilled') setContainers(c.value.containers);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const removeNet = async (n: DockerNetwork) => {
    if (!confirm(`Netzwerk "${n.name}" löschen?`)) return;
    try { await api.networks.remove(n.id); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };
  const disconnect = async (n: DockerNetwork, container: string) => {
    try { await api.networks.disconnect(n.id, container); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <>
      <Topbar
        title={t('nav.networks')}
        subtitle={t('page.networks.subtitle', { n: networks.length })}
        onRefresh={load}
        refreshing={refreshing}
        actions={view === 'docker' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn--outline btn--sm" onClick={() => setCreateGroupOpen(true)}><Box size={13} /> {tt('Gruppe')}</button>
            <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> {tt('Netzwerk')}</button>
          </div>
        )}
      />
      <main className="page">
        <div className="filter-tabs">
          <button className={`filter-tab${view === 'docker' ? ' filter-tab--active' : ''}`} onClick={() => setView('docker')}>{tt('Docker')}</button>
          <button className={`filter-tab${view === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setView('vm')}>VMs</button>
          <button className={`filter-tab${view === 'firewall' ? ' filter-tab--active' : ''}`} onClick={() => setView('firewall')}>{tt('Firewall')}</button>
          <button className={`filter-tab${view === 'karte' ? ' filter-tab--active' : ''}`} onClick={() => setView('karte')}>{tt('Live-Karte')}</button>
          <button className={`filter-tab${view === 'connections' ? ' filter-tab--active' : ''}`} onClick={() => setView('connections')}>{tt('Verbindungen')}</button>
          <button className={`filter-tab${view === 'vips' ? ' filter-tab--active' : ''}`} onClick={() => setView('vips')}>{tt('Virtuelle IPs')}</button>
        </div>

        {view === 'vm' && <VmNetworksView />}
        {view === 'firewall' && <FirewallView networks={networks} containers={containers} onChanged={load} />}
        {view === 'karte' && <NetworkMap networks={networks} containers={containers} />}
        {view === 'connections' && <ConnectionsPanel />}
        {view === 'vips' && <VirtualIpsPanel />}
        {view === 'docker' && networks.map((n) => (
          <Panel
            key={n.id}
            title={n.name}
            icon={n.internal ? <Lock size={15} /> : <Network size={15} />}
            subtitle={
              <>
                <span className="badge badge--paused" style={{ marginRight: 6 }}>{n.driver}</span>
                {n.vlan && <span className="badge badge--restarting" style={{ marginRight: 6 }}><Cable size={10} /> VLAN {n.vlan}</span>}
                {n.internal && <span className="badge badge--dead" style={{ marginRight: 6 }}>isoliert</span>}
                {n.subnet && <span className="dtable__mono" style={{ fontSize: 11 }}>{n.subnet}</span>}
              </>
            }
            storageKey={`net-${n.name}`}
            defaultCollapsed={n.builtin}
            actions={
              !n.builtin && (
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn--ghost btn--sm" onClick={() => setConnectNet(n)}><Link2 size={12} /> {tt('Verbinden')}</button>
                  <button className="btn btn--danger btn--icon btn--sm" onClick={() => removeNet(n)}><Trash2 size={12} /></button>
                </div>
              )
            }
          >
            {n.containers.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '8px 0' }}>Keine Container verbunden.{n.gateway && ` Gateway: ${n.gateway}`}</div>
            ) : (
              <table className="dtable" style={{ marginTop: 6 }}>
                <thead><tr><th>{tt('Container')}</th><th>{tt('IP-Adresse')}</th><th>MAC</th><th style={{ width: 44 }}></th></tr></thead>
                <tbody>
                  {n.containers.map((c) => (
                    <tr key={c.container}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{c.ipv4 || '—'}</td>
                      <td className="dtable__mono text-muted">{c.mac || '—'}</td>
                      <td>{!n.builtin && <button className="btn btn--ghost btn--icon btn--sm" title={tt('Trennen')} onClick={() => disconnect(n, c.container)}><Unlink size={12} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ))}
      </main>

      <CreateNetModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} interfaces={interfaces} />
      <CreateGroupModal open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} onDone={load} containers={containers} />
      <ConnectModal net={connectNet} open={!!connectNet} onClose={() => setConnectNet(null)} onDone={load} containers={containers} />
    </>
  );
}
