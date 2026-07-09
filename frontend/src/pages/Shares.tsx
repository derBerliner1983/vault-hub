import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Plus, Trash2, Play, Square, RotateCcw, UserPlus, ShieldOff, ShieldCheck, Info } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import type { Share } from '../lib/types';

function ShareModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Share>({ name: '', path: '', readOnly: false, guestOk: false, browseable: true });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!form.name.trim() || !form.path.startsWith('/')) { setError('Name und absoluter Pfad erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.shares.create(form);
      setForm({ name: '', path: '', readOnly: false, guestOk: false, browseable: true });
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  const check = (key: keyof Share, label: string, hint: string) => (
    <label className="legend__item" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={form[key] as boolean} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
      <span><b>{label}</b> — <span className="text-muted">{hint}</span></span>
    </label>
  );

  return (
    <Modal
      open={open}
      title={tt('Neue SMB-Freigabe')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Freigabe erstellen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{tt('Freigabename')}</label>
        <input className="input input--rect" placeholder={tt('Medien')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('Pfad')}</label>
        <input className="input input--rect" placeholder={tt('/mnt/daten/medien')} value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">{tt('Wird automatisch angelegt, falls nicht vorhanden.')}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {check('readOnly', 'Nur Lesen', 'Schreibzugriff verbieten')}
        {check('guestOk', 'Gastzugriff', 'ohne Passwort zugänglich')}
        {check('browseable', 'Sichtbar', 'in der Netzwerkumgebung anzeigen')}
      </div>
    </Modal>
  );
}

function SmbUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username || !password) { setError('Benutzer und Passwort erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.shares.addUser(username, password);
      setUsername(''); setPassword(''); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={tt('SMB-Benutzer hinzufügen')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Hinzufügen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-hint" style={{ marginBottom: 4 }}>{tt('Der Benutzer muss bereits als Linux-Benutzer existieren.')}</div>
      <div className="form-group">
        <label className="form-label">{tt('Benutzername')}</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{tt('SMB-Passwort')}</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
    </Modal>
  );
}

export function Shares() {
  const t = useT();
  const [shares, setShares] = useState<Share[]>([]);
  const [available, setAvailable] = useState(true);
  const [running, setRunning] = useState(false);
  const [firewallOpen, setFirewallOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.shares.list();
      setShares(res.shares);
      setAvailable(res.available);
      setRunning(res.running);
      setFirewallOpen(res.firewallOpen ?? false);
      setMessage(res.message ?? '');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const svc = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try { await api.shares.service(action); setTimeout(load, 800); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Freigabe "${name}" entfernen?`)) return;
    try { await api.shares.remove(name); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  // Firewall/running status badge
  const fwLabel = firewallOpen ? 'LAN offen' : 'geblockt';
  const fwColor = firewallOpen ? 'var(--color-success)' : 'var(--color-error)';
  const FwIcon = firewallOpen ? ShieldCheck : ShieldOff;

  const topbarSubtitle = available
    ? `Samba ${running ? 'läuft' : 'gestoppt'} · ${fwLabel}`
    : undefined;

  return (
    <>
      <Topbar
        title={t('nav.shares')}
        subtitle={topbarSubtitle}
        onRefresh={load}
        refreshing={refreshing}
        actions={available && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setUserModalOpen(true)}><UserPlus size={13} /> {tt('SMB-Benutzer')}</button>
            <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}><Plus size={13} /> {tt('Freigabe')}</button>
          </>
        )}
      />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><FolderOpen size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Samba nicht installiert')}</div>
            <div className="empty-state__desc">
              {message}<br /><br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>sudo apt install samba</code>
            </div>
          </div>
        ) : (
          <>
            {/* Auto-managed info banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              background: firewallOpen ? 'rgba(16,185,129,.07)' : 'rgba(239,68,68,.07)',
              border: `1px solid ${firewallOpen ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)'}`,
              borderRadius: 8, marginBottom: 14, fontSize: 12.5,
            }}>
              <FwIcon size={16} color={fwColor} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {shares.length === 0 ? (
                  <span>
                    <strong>{tt('Samba automatisch deaktiviert')}</strong> – Firewall blockiert Ports 137–139, 445.
                    {' '}Samba startet automatisch, wenn du eine Freigabe hinzufügst.
                  </span>
                ) : firewallOpen ? (
                  <span>
                    <strong>{tt('Samba aktiv – nur LAN')}</strong> – Ports 137–139, 445 sind nur aus dem lokalen Netzwerk erreichbar.
                    {' '}Internet-Zugang kann unter <em>{tt('Sicherheit')}</em> separat freigegeben werden.
                  </span>
                ) : (
                  <span>
                    <strong>{tt('Samba läuft, aber Firewall blockiert')}</strong> – Ports sind noch nicht freigegeben.
                    {' '}Füge eine Freigabe hinzu oder starte Samba manuell, damit die Firewall geöffnet wird.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Info size={11} color="var(--color-faint)" />
                <span style={{ fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Auto-verwaltet')}</span>
              </div>
            </div>

            <Panel
              title={tt('Freigaben')}
              icon={<FolderOpen size={15} />}
              subtitle={`${shares.length} aktiv`}
              storageKey="shares"
              actions={
                <div style={{ display: 'flex', gap: 4 }}>
                  {running ? (
                    <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('stop')}><Square size={12} /> {tt('Stop')}</button>
                  ) : (
                    <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('start')}><Play size={12} /> {tt('Start')}</button>
                  )}
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('restart')}><RotateCcw size={12} /> {tt('Neustart')}</button>
                </div>
              }
            >
              {shares.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state__desc">{tt('Noch keine Freigaben. Erstelle eine mit „Freigabe".')}</div>
                </div>
              ) : (
                <table className="dtable" style={{ marginTop: 6 }}>
                  <thead>
                    <tr><th>{tt('Name')}</th><th>{tt('Pfad')}</th><th>{tt('Zugriff')}</th><th>{tt('Optionen')}</th><th style={{ width: 44 }}></th></tr>
                  </thead>
                  <tbody>
                    {shares.map((s) => (
                      <tr key={s.name}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td className="dtable__mono text-muted">{s.path}</td>
                        <td>
                          <span className={`badge badge--${s.readOnly ? 'stopped' : 'running'}`}>
                            <span className="badge__dot" />{s.readOnly ? 'Nur Lesen' : 'Lesen/Schreiben'}
                          </span>
                        </td>
                        <td className="text-muted text-sm">
                          {s.guestOk ? 'Gast · ' : ''}{s.browseable ? 'sichtbar' : 'versteckt'}
                        </td>
                        <td>
                          <button className="btn btn--danger btn--icon btn--sm" title={tt('Entfernen')} onClick={() => remove(s.name)}><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        )}
      </main>

      <ShareModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
      <SmbUserModal open={userModalOpen} onClose={() => setUserModalOpen(false)} />
    </>
  );
}
