import { useEffect, useRef, useState, useCallback } from 'react';
import { TerminalSquare, RotateCcw, Power } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';

type Conn = 'connecting' | 'open' | 'closed';

export function Terminal() {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Conn>('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);

  const connect = useCallback((term: XTerm, fit: FitAddon) => {
    setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      fit.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (ev) => { term.write(typeof ev.data === 'string' ? ev.data : ''); };
    ws.onclose = () => {
      setStatus('closed');
      term.write('\r\n\x1b[33m── Verbindung getrennt ──\x1b[0m\r\n');
    };
    ws.onerror = () => { setStatus('closed'); };

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data: d }));
    });
    return () => { onData.dispose(); ws.close(); };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#1C1C1F',
        foreground: '#F4F4F5',
        cursor: '#34D399',
        selectionBackground: '#3f3f46',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const cleanupConn = connect(term, fit);

    const doResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch { /* */ }
    };

    // ResizeObserver reacts to sidebar collapse / window resize / any layout change
    const ro = new ResizeObserver(doResize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cleanupConn();
      term.dispose();
    };
  }, [connect, reconnectKey]);

  const reconnect = () => setReconnectKey((k) => k + 1);

  const statusBadge = status === 'open'
    ? <span className="badge badge--running"><span className="badge__dot" />verbunden</span>
    : status === 'connecting'
      ? <span className="badge badge--restarting"><span className="badge__dot" />verbinde…</span>
      : <span className="badge badge--stopped"><span className="badge__dot" />getrennt</span>;

  return (
    <>
      <Topbar
        title={t('nav.terminal')}
        subtitle={t('page.terminal.subtitle')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {statusBadge}
            <button className="btn btn--outline btn--sm" onClick={reconnect} title={tt('Neu verbinden')}>
              {status === 'closed' ? <Power size={13} /> : <RotateCcw size={13} />} Neu verbinden
            </button>
          </div>
        }
      />
      {/* Override .page so terminal fills all remaining height without scrolling */}
      <main style={{ flex: 1, overflow: 'hidden', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-subtle)', fontSize: 12.5, flexShrink: 0 }}>
            <TerminalSquare size={15} />
            <span>{tt('Interaktive Shell – Befehle werden direkt auf dem Server ausgeführt.')}</span>
          </div>
          {/* position:relative needed for xterm-viewport (absolute). No padding: FitAddon clipping. */}
          <div ref={containerRef} style={{ flex: 1, background: '#1C1C1F', minHeight: 0, position: 'relative', overflow: 'hidden' }} />
        </div>
        <div className="form-hint" style={{ flexShrink: 0 }}>
          ⚠️ Diese Konsole läuft mit Root-Rechten auf dem Server. Sei vorsichtig mit Befehlen, die das System verändern.
        </div>
      </main>
    </>
  );
}
