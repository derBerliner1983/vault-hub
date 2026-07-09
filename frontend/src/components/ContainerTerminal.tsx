import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { tt } from '../lib/i18n';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { X, RotateCcw, SquareTerminal } from 'lucide-react';

type Conn = 'connecting' | 'open' | 'closed';

/**
 * Interaktive Shell IN einem Container (docker exec) als Overlay-Modal.
 * Verbindet sich per WebSocket mit /api/containers/:id/exec.
 */
export function ContainerTerminal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Conn>('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);

  const connect = useCallback((term: XTerm, fit: FitAddon) => {
    setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/containers/${id}/exec`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      fit.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (ev) => { term.write(typeof ev.data === 'string' ? ev.data : ''); };
    ws.onclose = () => { setStatus('closed'); term.write('\r\n\x1b[33m── Verbindung getrennt ──\x1b[0m\r\n'); };
    ws.onerror = () => { setStatus('closed'); };

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data: d }));
    });
    return () => { onData.dispose(); ws.close(); };
  }, [id]);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1C1C1F', foreground: '#F4F4F5', cursor: '#34D399', selectionBackground: '#3f3f46' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    const cleanupConn = connect(term, fit);

    const onResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch { /* */ }
    };
    window.addEventListener('resize', onResize);

    return () => { window.removeEventListener('resize', onResize); cleanupConn(); term.dispose(); };
  }, [connect, reconnectKey]);

  // Esc schließt
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);

  const statusBadge = status === 'open'
    ? <span className="badge badge--running"><span className="badge__dot" />verbunden</span>
    : status === 'connecting'
      ? <span className="badge badge--restarting"><span className="badge__dot" />verbinde…</span>
      : <span className="badge badge--stopped"><span className="badge__dot" />getrennt</span>;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 860, width: '92vw' }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SquareTerminal size={16} /> Konsole: {name}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {statusBadge}
            <button className="btn btn--outline btn--sm" onClick={() => setReconnectKey((k) => k + 1)} title={tt('Neu verbinden')}>
              <RotateCcw size={13} /> Neu verbinden
            </button>
            <button className="icon-btn" onClick={onClose}><X size={15} /></button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-subtle)', fontSize: 12 }}>
            Befehle werden direkt im Container ausgeführt (bash/sh).
          </div>
          <div ref={containerRef} style={{ height: '60vh', minHeight: 320, background: '#1C1C1F', padding: 10 }} />
        </div>
      </div>
    </div>
  );
}
