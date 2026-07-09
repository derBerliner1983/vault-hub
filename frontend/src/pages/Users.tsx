import { useState, useEffect, useCallback } from 'react';
import { Users as UsersIcon, Terminal, Plus, Trash2, KeyRound, Shield, ShieldCheck, ShieldOff, ShieldAlert, LogOut } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { api } from '../lib/api';
import { avatarColor } from '../lib/utils';
import { useAuth } from '../lib/auth';
import type { UserPublic, LinuxUser } from '../lib/types';

function AppUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username || !password) { setError('Benutzer und Passwort erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.users.create({ username, password, role });
      setUsername(''); setPassword(''); setRole('viewer'); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Neuer Vault-Hub Login')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Benutzername')}</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">{tt('Passwort')}</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">{tt('Rolle')}</label>
        <select className="input input--rect" value={role} onChange={(e) => setRole(e.target.value)} style={{ cursor: 'pointer' }}>
          <option value="viewer">Viewer (nur ansehen)</option>
          <option value="admin">Admin (volle Rechte)</option>
        </select></div>
    </Modal>
  );
}

function LinuxUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sudo, setSudo] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username) { setError('Benutzername erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.linuxUsers.create({ username, password: password || undefined, sudo });
      setUsername(''); setPassword(''); setSudo(false); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={tt('Neuer Linux-Benutzer')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Anlegen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Benutzername')}</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Passwort (optional)</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <label className="legend__item" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={sudo} onChange={(e) => setSudo(e.target.checked)} />
        <span><Shield size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <b>{tt('sudo-Rechte')}</b> {tt('— Administrator')}</span>
      </label>
    </Modal>
  );
}

export function Users() {
  const t = useT();
  const { user } = useAuth();
  const [appUsers, setAppUsers] = useState<UserPublic[]>([]);
  const [linuxUsers, setLinuxUsers] = useState<LinuxUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [appModal, setAppModal] = useState(false);
  const [linuxModal, setLinuxModal] = useState(false);
  const [deleteAppConfirm, setDeleteAppConfirm] = useState<UserPublic | null>(null);
  const [deleteLinuxConfirm, setDeleteLinuxConfirm] = useState<string | null>(null);
  const [linuxDeleteHome, setLinuxDeleteHome] = useState(false);
  const [actionUser, setActionUser] = useState<UserPublic | null>(null);
  const [actionType, setActionType] = useState<'require2fa' | 'unrequire2fa' | 'reset2fa' | 'revokeSessions' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [a, l] = await Promise.allSettled([api.users.list(), api.linuxUsers.list()]);
      if (a.status === 'fulfilled') setAppUsers(a.value.users);
      if (l.status === 'fulfilled') setLinuxUsers(l.value.users);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const delApp = async (u: UserPublic) => { setDeleteAppConfirm(u); };
  const delLinux = async (name: string) => { setLinuxDeleteHome(false); setDeleteLinuxConfirm(name); };

  const setLinuxPw = async (name: string) => {
    const pw = prompt(`Neues Passwort für "${name}":`);
    if (!pw) return;
    try { await api.linuxUsers.setPassword(name, pw); alert(tt('Passwort geändert.')); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const startAction = (u: UserPublic, type: typeof actionType) => {
    setActionUser(u);
    setActionType(type);
  };

  const confirmAction = async () => {
    if (!actionUser || !actionType) return;
    setActionLoading(true);
    try {
      if (actionType === 'require2fa') await api.users.require2fa(actionUser.id, true);
      else if (actionType === 'unrequire2fa') await api.users.require2fa(actionUser.id, false);
      else if (actionType === 'reset2fa') await api.users.reset2fa(actionUser.id);
      else if (actionType === 'revokeSessions') await api.users.revokeSessions(actionUser.id);
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setActionLoading(false); setActionUser(null); setActionType(null); }
  };

  const actionMeta: Record<NonNullable<typeof actionType>, { title: string; message: (u: UserPublic) => string; label: string; danger?: boolean }> = {
    require2fa: {
      title: '2FA erzwingen',
      message: (u) => `2FA für "${u.username}" als Pflicht markieren? Der Benutzer wird beim nächsten Login aufgefordert, 2FA einzurichten.`,
      label: '2FA erzwingen',
    },
    unrequire2fa: {
      title: '2FA-Pflicht aufheben',
      message: (u) => `Die 2FA-Pflicht für "${u.username}" aufheben?`,
      label: 'Aufheben',
    },
    reset2fa: {
      title: '2FA zurücksetzen',
      message: (u) => `2FA für "${u.username}" deaktivieren und alle vertrauenswürdigen Geräte entfernen? (z.B. bei verlorenen Gerät)`,
      label: '2FA deaktivieren',
      danger: true,
    },
    revokeSessions: {
      title: 'Alle Sitzungen widerrufen',
      message: (u) => `Alle vertrauenswürdigen Geräte/Sitzungen von "${u.username}" widerrufen? Er wird beim nächsten Login erneut nach 2FA gefragt.`,
      label: 'Widerrufen',
      danger: true,
    },
  };

  return (
    <>
      <Topbar title={t('nav.users')} subtitle={t('page.users.subtitle', { logins: appUsers.length, linux: linuxUsers.length })} onRefresh={load} refreshing={refreshing} />
      <main className="page">
        <SortablePanels storageKey="users" items={[
          { id: 'corehub', node: (
        <Panel
          title={tt('Vault-Hub Logins')}
          icon={<UsersIcon size={15} />}
          subtitle={tt('Zugänge zur Weboberfläche')}
          storageKey="appusers"
          actions={<button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setAppModal(true); }}><Plus size={13} /> {tt('Login')}</button>}
        >
          <table className="dtable" style={{ marginTop: 6 }}>
            <thead><tr><th>{tt('Benutzer')}</th><th>{tt('Rolle')}</th><th>2FA</th><th>{tt('Erstellt')}</th><th style={{ width: 44 }}></th></tr></thead>
            <tbody>
              {appUsers.map((u) => {
                const has2fa = !!u.totp_enabled;
                const required2fa = !!u.totp_required;
                return (
                  <tr key={u.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="sidebar__avatar" style={{ background: avatarColor(u.username) }}>{u.username.charAt(0).toUpperCase()}</div>
                      <span style={{ fontWeight: 600 }}>{u.username}</span>
                    </div></td>
                    <td><span className={`badge badge--${u.role === 'admin' ? 'running' : 'paused'}`}>{u.role}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {has2fa
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}><ShieldCheck size={12} /> aktiv</span>
                          : required2fa
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-warning)', fontWeight: 600 }}><ShieldAlert size={12} /> erzwungen</span>
                            : <span style={{ fontSize: 11, color: 'var(--color-faint)' }}>–</span>
                        }
                        {user?.role === 'admin' && u.id !== user?.id && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {!required2fa && !has2fa && (
                              <button className="btn btn--ghost btn--icon btn--sm" title={tt('2FA erzwingen')} onClick={() => startAction(u, 'require2fa')}>
                                <ShieldAlert size={11} />
                              </button>
                            )}
                            {required2fa && !has2fa && (
                              <button className="btn btn--ghost btn--icon btn--sm" title={tt('2FA-Pflicht aufheben')} onClick={() => startAction(u, 'unrequire2fa')}>
                                <ShieldOff size={11} />
                              </button>
                            )}
                            {has2fa && (
                              <button className="btn btn--ghost btn--icon btn--sm" title={tt('2FA zurücksetzen (z.B. Gerät verloren)')} onClick={() => startAction(u, 'reset2fa')}>
                                <ShieldOff size={11} />
                              </button>
                            )}
                            <button className="btn btn--ghost btn--icon btn--sm" title={tt('Alle Sitzungen widerrufen')} onClick={() => startAction(u, 'revokeSessions')}>
                              <LogOut size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="text-muted">{u.created_at?.slice(0, 10)}</td>
                    <td>
                      {u.id !== user?.id && (
                        <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} onClick={() => delApp(u)}><Trash2 size={12} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Bulk 2FA enforce for users without 2FA */}
          {user?.role === 'admin' && appUsers.some((u) => !u.totp_enabled && !u.totp_required && u.id !== user?.id) && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  const targets = appUsers.filter((u) => !u.totp_enabled && !u.totp_required && u.id !== user?.id);
                  for (const u of targets) await api.users.require2fa(u.id, true).catch(() => null);
                  await load();
                }}
              >
                <ShieldAlert size={12} /> 2FA für alle erzwingen (ohne aktives 2FA)
              </button>
            </div>
          )}
        </Panel>
          ) },
          { id: 'linux', node: (
        <Panel
          title={tt('Linux-Benutzer')}
          icon={<Terminal size={15} />}
          subtitle={tt('Systembenutzer des Servers')}
          storageKey="linuxusers"
          defaultCollapsed
          actions={<button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setLinuxModal(true); }}><Plus size={13} /> {tt('Benutzer')}</button>}
        >
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="dtable">
              <thead><tr><th>{tt('Benutzer')}</th><th>UID</th><th>{tt('Gruppen')}</th><th>{tt('Shell')}</th><th style={{ width: 80 }}></th></tr></thead>
              <tbody>
                {linuxUsers.map((u) => (
                  <tr key={u.username}>
                    <td style={{ fontWeight: 600 }}>
                      {u.username}
                      {u.groups.includes('sudo') && <Shield size={11} style={{ marginLeft: 6, color: 'var(--color-warning)', display: 'inline', verticalAlign: 'middle' }} />}
                    </td>
                    <td className="dtable__mono">{u.uid}</td>
                    <td className="text-muted text-sm" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.groups.join(', ')}</td>
                    <td className="dtable__mono text-muted">{u.shell}</td>
                    <td>
                      <div className="dtable__actions">
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Passwort ändern')} onClick={() => setLinuxPw(u.username)}><KeyRound size={12} /></button>
                        <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} onClick={() => delLinux(u.username)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
          ) },
        ]} />
      </main>

      <AppUserModal open={appModal} onClose={() => setAppModal(false)} onDone={load} />
      <LinuxUserModal open={linuxModal} onClose={() => setLinuxModal(false)} onDone={load} />

      <ConfirmModal
        open={!!deleteAppConfirm}
        title={tt('Login löschen')}
        message={`Soll der Login "${deleteAppConfirm?.username}" wirklich gelöscht werden?`}
        confirmLabel="Löschen"
        danger
        onConfirm={async () => {
          if (deleteAppConfirm) {
            try { await api.users.delete(deleteAppConfirm.id); await load(); } catch { /* */ }
          }
          setDeleteAppConfirm(null);
        }}
        onCancel={() => setDeleteAppConfirm(null)}
      />

      {/* Linux user delete – extra option to keep/remove home */}
      <ConfirmModal
        open={!!deleteLinuxConfirm}
        title={tt('Linux-Benutzer löschen')}
        message={`Soll der Benutzer "${deleteLinuxConfirm}" gelöscht werden?`}
        extra={
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={linuxDeleteHome} onChange={(e) => setLinuxDeleteHome(e.target.checked)} />
            Home-Verzeichnis mitlöschen
          </label>
        }
        confirmLabel="Löschen"
        danger
        onConfirm={async () => {
          if (deleteLinuxConfirm) {
            try { await api.linuxUsers.remove(deleteLinuxConfirm, linuxDeleteHome); await load(); } catch { /* */ }
          }
          setDeleteLinuxConfirm(null);
        }}
        onCancel={() => setDeleteLinuxConfirm(null)}
      />

      {/* 2FA / session action confirm */}
      {actionUser && actionType && (
        <ConfirmModal
          open
          title={actionMeta[actionType].title}
          message={actionMeta[actionType].message(actionUser)}
          confirmLabel={actionLoading ? '…' : actionMeta[actionType].label}
          danger={actionMeta[actionType].danger}
          onConfirm={confirmAction}
          onCancel={() => { setActionUser(null); setActionType(null); }}
        />
      )}
    </>
  );
}
