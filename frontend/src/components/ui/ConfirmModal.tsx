import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { tt } from '../../lib/i18n';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  extra?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, message, extra, confirmLabel = 'Bestätigen', danger = false, loading, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {danger && <AlertTriangle size={18} color="var(--color-error)" />}
            <span className="modal-title">{title}</span>
          </div>
        </div>
        <div className="modal-body" style={{ gap: extra ? 12 : 0 }}>
          <p style={{ fontSize: 13.5, color: 'var(--color-muted)', lineHeight: 1.6 }}>{message}</p>
          {extra}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost btn--md" onClick={onCancel} disabled={loading}>{tt('Abbrechen')}</button>
          <button
            className="btn btn--md"
            style={danger ? { background: 'var(--color-error)', color: '#fff', borderColor: 'var(--color-error)' } : { background: 'var(--color-accent)', color: '#fff', borderColor: 'var(--color-accent)' }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
