import { useState, useEffect, useCallback } from 'react';
import { Mail, BellRing, Plus, Trash2, Send, Server } from 'lucide-react';
import { tt } from '../../lib/i18n';
import { Panel } from '../ui/Panel';
import { Switch } from '../ui/Switch';
import { api } from '../../lib/api';
import type { AlertRule, PredefinedAlert, AlertMetric, NotificationConfig } from '../../lib/types';

export function SmtpPanel() {
  const [cfg, setCfg] = useState<NotificationConfig | null>(null);
  const [form, setForm] = useState({ smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', smtpFrom: '', smtpSecure: false });
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const res = await api.notifications.list();
    setCfg(res.config);
    setForm({
      smtpHost: res.config.smtpHost ?? '',
      smtpPort: res.config.smtpPort ?? 587,
      smtpUser: res.config.smtpUser ?? '',
      smtpPass: '',
      smtpFrom: res.config.smtpFrom ?? '',
      smtpSecure: res.config.smtpSecure ?? false,
    });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await api.notifications.saveSmtp(form);
      setMsg('✓ SMTP-Einstellungen gespeichert');
      await load();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Fehler'); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setMsg('');
    try {
      await api.notifications.testSmtp(testTo || undefined);
      setMsg('✓ Test-E-Mail verschickt – prüfe dein Postfach');
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Versand fehlgeschlagen'); }
  };

  return (
    <Panel
      title={tt('E-Mail-Versand (SMTP)')}
      icon={<Server size={15} />}
      subtitle={cfg?.smtpConfigured ? 'konfiguriert' : 'nicht konfiguriert'}
      storageKey="sec-smtp"
      defaultCollapsed={!!cfg?.smtpConfigured}
    >
      <div style={{ marginTop: 8 }}>
        <div className="form-hint" style={{ marginBottom: 12 }}>
          Trage hier deinen Mail-Anbieter ein (z.B. Gmail: smtp.gmail.com, Port 465 SSL; oder dein eigener Server).
          Für Gmail brauchst du ein <b>{tt('App-Passwort')}</b>.
        </div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">{tt('SMTP-Server')}</label>
            <input className="input input--rect" placeholder={tt('smtp.gmail.com')} value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">{tt('Port')}</label>
            <input className="input input--rect" type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: +e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{tt('Benutzer')}</label>
            <input className="input input--rect" placeholder={tt('dein@gmail.com')} value={form.smtpUser} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Passwort {cfg?.smtpConfigured && <span style={{ color: 'var(--color-faint)' }}>(leer = unverändert)</span>}</label>
            <input className="input input--rect" type="password" placeholder="••••••••" value={form.smtpPass} onChange={(e) => setForm({ ...form, smtpPass: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Absender (From)</label>
            <input className="input input--rect" placeholder={tt('vault-hub@deine-domain.de')} value={form.smtpFrom} onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })} />
          </div>
          <div className="form-group" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <label className="form-label">SSL (Port 465)</label>
            <div style={{ paddingTop: 6 }}>
              <Switch checked={form.smtpSecure} onChange={(v) => setForm({ ...form, smtpSecure: v })} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving && <span className="spinner" style={{ width: 12, height: 12 }} />} Speichern
          </button>
          <input className="input input--rect" style={{ width: 200 }} placeholder={tt('Test an … (optional)')} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn btn--outline btn--sm" onClick={test}><Send size={12} /> {tt('Test-E-Mail')}</button>
        </div>
        {msg && <div className="form-hint" style={{ marginTop: 10, color: msg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>{msg}</div>}
      </div>
    </Panel>
  );
}

export function AlertsPanel() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [predefined, setPredefined] = useState<PredefinedAlert[]>([]);
  const [metrics, setMetrics] = useState<AlertMetric[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  // Formular für neue Regel
  const [kind, setKind] = useState<'predefined' | 'metric'>('predefined');
  const [ruleKey, setRuleKey] = useState('');
  const [metric, setMetric] = useState('cpu');
  const [threshold, setThreshold] = useState(90);
  const [durationMin, setDurationMin] = useState(5);
  const [recipients, setRecipients] = useState('');

  const load = useCallback(async () => {
    const res = await api.alerts.list();
    setRules(res.rules);
    setPredefined(res.predefined);
    setMetrics(res.metrics);
    if (!ruleKey && res.predefined[0]) setRuleKey(res.predefined[0].key);
  }, [ruleKey]);
  useEffect(() => { void load(); }, [load]);

  const selectedPredef = predefined.find((p) => p.key === ruleKey);

  const create = async () => {
    setMsg('');
    try {
      await api.alerts.create({
        kind,
        ruleKey: kind === 'predefined' ? ruleKey : undefined,
        metric: kind === 'metric' ? metric : undefined,
        threshold: kind === 'metric' ? threshold : (selectedPredef?.hasThreshold ? threshold : undefined),
        durationMin: kind === 'metric' ? durationMin : 0,
        recipients: recipients.trim() || undefined,
      });
      setAdding(false);
      setRecipients('');
      await load();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Fehler'); }
  };

  const toggle = async (r: AlertRule) => {
    setBusy(r.id);
    try { await api.alerts.toggle(r.id, !r.enabled); await load(); }
    finally { setBusy(null); }
  };

  const remove = async (r: AlertRule) => {
    if (!confirm(`Regel „${r.name}" löschen?`)) return;
    setBusy(r.id);
    try { await api.alerts.remove(r.id); await load(); }
    finally { setBusy(null); }
  };

  const test = async (r: AlertRule) => {
    setBusy(r.id); setMsg('');
    try { await api.alerts.test(r.id); setMsg(`✓ Test-E-Mail für „${r.name}" verschickt`); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Versand fehlgeschlagen'); }
    finally { setBusy(null); }
  };

  return (
    <Panel
      title={tt('Alarm-Regeln (E-Mail bei Auffälligkeiten)')}
      icon={<BellRing size={15} />}
      subtitle={`${rules.length} Regel(n)`}
      storageKey="sec-alerts"
      actions={<button className="btn btn--primary btn--sm" onClick={() => setAdding((v) => !v)}><Plus size={13} /> {tt('Regel')}</button>}
    >
      <div style={{ marginTop: 6 }}>
        {adding && (
          <div className="card" style={{ background: 'var(--color-surface-sunken)', marginBottom: 14 }}>
            <div className="card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{tt('Art')}</label>
                  <select className="input input--rect" value={kind} onChange={(e) => setKind(e.target.value as 'predefined' | 'metric')} style={{ cursor: 'pointer' }}>
                    <option value="predefined">{tt('Vordefinierte Auffälligkeit')}</option>
                    <option value="metric">{tt('Eigener Schwellwert')}</option>
                  </select>
                </div>
                {kind === 'predefined' ? (
                  <div className="form-group">
                    <label className="form-label">{tt('Auffälligkeit')}</label>
                    <select className="input input--rect" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} style={{ cursor: 'pointer' }}>
                      {predefined.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">{tt('Metrik')}</label>
                    <select className="input input--rect" value={metric} onChange={(e) => setMetric(e.target.value)} style={{ cursor: 'pointer' }}>
                      {metrics.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {kind === 'predefined' && selectedPredef?.description && (
                <div className="form-hint" style={{ marginBottom: 10 }}>{selectedPredef.description}</div>
              )}

              <div className="form-row">
                {(kind === 'metric' || selectedPredef?.hasThreshold) && (
                  <div className="form-group">
                    <label className="form-label">{kind === 'metric' ? 'Schwellwert (%)' : (selectedPredef?.thresholdLabel ?? 'Schwellwert')}</label>
                    <input className="input input--rect" type="number" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
                  </div>
                )}
                {kind === 'metric' && (
                  <div className="form-group">
                    <label className="form-label">Dauer (Minuten über Schwelle)</label>
                    <input className="input input--rect" type="number" value={durationMin} onChange={(e) => setDurationMin(+e.target.value)} />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Empfänger-E-Mails (mehrere mit Komma; leer = globale Adresse)</label>
                <input className="input input--rect" placeholder={tt('admin@firma.de, technik@firma.de')} value={recipients} onChange={(e) => setRecipients(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--primary btn--sm" onClick={create}>{tt('Regel anlegen')}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setAdding(false)}>{tt('Abbrechen')}</button>
              </div>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className="form-hint" style={{ padding: '8px 2px' }}>
            Noch keine Alarm-Regeln. Lege eine an, um bei Auffälligkeiten automatisch E-Mails zu erhalten.
          </div>
        ) : (
          <div>
            {rules.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--color-border)' }}>
                <Switch checked={r.enabled} disabled={busy === r.id} onChange={() => toggle(r)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-subtle)', marginTop: 2 }}>
                    <Mail size={11} style={{ display: 'inline', verticalAlign: -1 }} />{' '}
                    {r.recipients || 'globale E-Mail-Adresse'}
                    {r.lastTriggered && <> · zuletzt ausgelöst {new Date(r.lastTriggered).toLocaleString('de-DE')}</>}
                  </div>
                </div>
                <button className="btn btn--outline btn--sm" disabled={busy === r.id} onClick={() => test(r)} title={tt('Test-E-Mail')}><Send size={12} /></button>
                <button className="btn btn--danger btn--icon btn--sm" disabled={busy === r.id} onClick={() => remove(r)} title={tt('Löschen')}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
        {msg && <div className="form-hint" style={{ marginTop: 10, color: msg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>{msg}</div>}
      </div>
    </Panel>
  );
}

export function SecurityAlerts() {
  return <AlertsPanel />;
}
