import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Power, RotateCcw, Plus, Trash2, Camera, Star, MonitorPlay } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { api } from '../lib/api';
import { formatBytes, avatarColor } from '../lib/utils';
import type { VM } from '../lib/types';

const OS_VARIANTS = [
  { label: 'Generisch', value: 'generic' },
  { label: 'Ubuntu 24.04', value: 'ubuntu24.04' },
  { label: 'Debian 12', value: 'debian12' },
  { label: 'Windows 11', value: 'win11' },
  { label: 'Fedora', value: 'fedora-unknown' },
];

function stateBadge(state: string): string {
  const s = state.toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('paused')) return 'paused';
  if (s.includes('shut')) return 'stopped';
  return 'stopped';
}

function CreateVMModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', memory: 2048, vcpus: 2, diskSize: 20, iso: '', osVariant: 'generic' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const create = async () => {
    if (!form.name.trim()) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.vms.create(form);
      onCreated(); onClose();
      setForm({ name: '', memory: 2048, vcpus: 2, diskSize: 20, iso: '', osVariant: 'generic' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={tt('Neue VM erstellen')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={create} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} VM erstellen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{tt('Name *')}</label>
        <input className="input input--rect" placeholder={tt('meine-vm')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">RAM (MB)</label>
          <input className="input input--rect" type="number" value={form.memory} onChange={(e) => setForm({ ...form, memory: +e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">vCPUs</label>
          <input className="input input--rect" type="number" value={form.vcpus} onChange={(e) => setForm({ ...form, vcpus: +e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Festplatte (GB)</label>
          <input className="input input--rect" type="number" value={form.diskSize} onChange={(e) => setForm({ ...form, diskSize: +e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Betriebssystem')}</label>
          <select className="input input--rect" value={form.osVariant} onChange={(e) => setForm({ ...form, osVariant: e.target.value })} style={{ cursor: 'pointer' }}>
            {OS_VARIANTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">ISO-Pfad (optional, zum Installieren)</label>
        <input className="input input--rect" placeholder={tt('/var/lib/libvirt/images/ubuntu.iso')} value={form.iso} onChange={(e) => setForm({ ...form, iso: e.target.value })} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        <div className="form-hint">Ohne ISO wird die VM mit leerer Festplatte erstellt (--import).</div>
      </div>
    </Modal>
  );
}

export function VMs() {
  const t = useT();
  const [vms, setVms] = useState<VM[]>([]);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.vms.list();
      setVms(res.vms);
      setAvailable(res.available);
      setMessage(res.message ?? '');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);

  const action = async (name: string, label: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [name]: label }));
    try { await fn(); setTimeout(() => void load(), 800); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[name]; return n; }); }
  };

  return (
    <>
      <Topbar
        title={t('nav.vms')}
        subtitle={available ? t('page.vms.subtitle', { running: vms.filter((v) => v.state.includes('running')).length, total: vms.length }) : undefined}
        onRefresh={load}
        refreshing={refreshing}
        actions={available && (
          <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> Neue VM
          </button>
        )}
      />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><MonitorPlay size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">libvirt nicht installiert</div>
            <div className="empty-state__desc">
              {message || 'Installiere libvirt & qemu-kvm, um VMs zu verwalten:'}
              <br /><br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>
                sudo apt install qemu-kvm libvirt-daemon-system virtinst
              </code>
            </div>
          </div>
        ) : vms.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon"><MonitorPlay size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Keine VMs vorhanden')}</div>
            <div className="empty-state__desc">{tt('Erstelle deine erste virtuelle Maschine mit dem Button oben rechts.')}</div>
          </div>
        ) : (
          <div className="container-grid">
            {vms.map((vm) => {
              const running = vm.state.includes('running');
              const b = busy[vm.name];
              return (
                <div className="container-card" key={vm.id}>
                  <div className="container-card__header">
                    <div className="container-avatar" style={{ background: avatarColor(vm.name) }}>
                      <MonitorPlay size={16} />
                    </div>
                    <div className="container-card__info">
                      <div className="container-card__name">{vm.name}</div>
                      <div className="container-card__image">
                        {vm.vcpus} vCPU · {formatBytes(vm.memory * 1024)}
                        {vm.autostart && <span style={{ color: 'var(--color-warning)' }}> {tt('· ★ Autostart')}</span>}
                      </div>
                    </div>
                    <span className={`badge badge--${stateBadge(vm.state)}`}>
                      <span className="badge__dot" />{vm.state}
                    </span>
                  </div>

                  <div className="container-card__footer">
                    <span className="container-card__status-text">{vm.state}</span>
                    {!running ? (
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('Starten')} disabled={!!b} onClick={() => action(vm.name, 'start', () => api.vms.start(vm.name))}>
                        {b === 'start' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
                      </button>
                    ) : (
                      <>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Herunterfahren')} disabled={!!b} onClick={() => action(vm.name, 'shutdown', () => api.vms.shutdown(vm.name))}>
                          {b === 'shutdown' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Power size={12} />}
                        </button>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Hart ausschalten')} disabled={!!b} onClick={() => action(vm.name, 'stop', () => api.vms.stop(vm.name))}>
                          <Square size={12} />
                        </button>
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Neustart')} disabled={!!b} onClick={() => action(vm.name, 'reboot', () => api.vms.reboot(vm.name))}>
                          <RotateCcw size={12} />
                        </button>
                      </>
                    )}
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Snapshot erstellen')} disabled={!!b} onClick={() => action(vm.name, 'snap', () => api.vms.snapshot(vm.name))}>
                      {b === 'snap' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Camera size={12} />}
                    </button>
                    <button className="btn btn--ghost btn--icon btn--sm" title={tt('Autostart umschalten')} disabled={!!b} onClick={() => action(vm.name, 'auto', () => api.vms.toggleAutostart(vm.name))} style={vm.autostart ? { color: 'var(--color-warning)' } : undefined}>
                      <Star size={12} fill={vm.autostart ? 'currentColor' : 'none'} />
                    </button>
                    <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={!!b} onClick={() => setDeleteConfirm(vm.name)}>
                      {b === 'del' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <CreateVMModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <ConfirmModal
        open={!!deleteConfirm}
        title={tt('VM löschen')}
        message={`Soll "${deleteConfirm}" inkl. Festplatte unwiderruflich gelöscht werden?`}
        confirmLabel="Löschen"
        danger
        onConfirm={() => {
          if (deleteConfirm) void action(deleteConfirm, 'del', () => api.vms.remove(deleteConfirm));
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
