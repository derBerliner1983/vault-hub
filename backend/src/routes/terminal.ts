import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { auditQueries } from '../db/index';
import { isRoot } from '../lib/privilege';

// node-pty ist eine optionale (native) Abhängigkeit. Wenn sie nicht gebaut
// werden konnte, fallen wir auf `script` zurück (ohne Live-Resize).
interface PtyLike {
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: () => void) => void;
  write: (d: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodePty: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodePty = require('node-pty');
} catch {
  nodePty = null;
}

/** Startet eine interaktive Shell (als root via sudo, falls nicht schon root). */
function startShell(cols: number, rows: number): PtyLike {
  // /bin/bash explizit, da die sudoers-Allowlist genau diesen Pfad NOPASSWD erlaubt
  const shellCmd = isRoot ? '/bin/bash' : 'sudo';
  const shellArgs = isRoot ? ['-l'] : ['-n', '/bin/bash', '-l'];
  // cwd muss für den vault-hub-Benutzer zugänglich sein (sudo wechselt erst danach zu root)
  const cwd = process.env.HOME && process.env.HOME !== '/root' ? process.env.HOME : '/';
  const env = { ...process.env, TERM: 'xterm-256color', LANG: process.env.LANG || 'C.UTF-8' };

  if (nodePty) {
    const term = nodePty.spawn(shellCmd, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env,
    });
    return {
      onData: (cb) => term.onData(cb),
      onExit: (cb) => term.onExit(cb),
      write: (d) => term.write(d),
      resize: (c, r) => { try { term.resize(c || 80, r || 24); } catch { /* */ } },
      kill: () => { try { term.kill(); } catch { /* */ } },
    };
  }

  // Fallback: util-linux `script` erzeugt ebenfalls ein PTY (kein Live-Resize)
  const innerCmd = isRoot ? '/bin/bash -l' : 'sudo -n /bin/bash -l';
  const child: ChildProcessWithoutNullStreams = spawn('script', ['-qfc', innerCmd, '/dev/null'], {
    cwd,
    env: { ...env, COLUMNS: String(cols || 80), LINES: String(rows || 24) },
  }) as ChildProcessWithoutNullStreams;
  return {
    onData: (cb) => { child.stdout.on('data', (d) => cb(d.toString())); child.stderr.on('data', (d) => cb(d.toString())); },
    onExit: (cb) => child.on('close', cb),
    write: (d) => { try { child.stdin.write(d); } catch { /* */ } },
    resize: () => { /* script unterstützt kein Live-Resize */ },
    kill: () => { try { child.kill(); } catch { /* */ } },
  };
}

interface ClientMsg {
  type: 'data' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

export async function terminalRoutes(fastify: FastifyInstance) {
  // Infos für das Frontend (ist node-pty verfügbar?)
  fastify.get('/api/terminal/info', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
    if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Admin erforderlich' });
    reply.send({ available: true, resize: !!nodePty });
  });

  fastify.get('/api/terminal', { websocket: true }, (ws, req) => {
    // @fastify/websocket v11 (Fastify 5): der Handler bekommt den WebSocket direkt.

    // Authentifizierung über JWT-Cookie (vom Browser automatisch gesendet)
    void (async () => {
      try {
        await req.jwtVerify();
      } catch {
        ws.close(1008, 'Unauthorized');
        return;
      }
      if (req.user.role !== 'admin') {
        ws.close(1008, 'Admin erforderlich');
        return;
      }

      auditQueries.log.run(req.user.id, 'terminal.open', null);

      let term: PtyLike | null = null;
      let started = false;

      const ensureStarted = (cols: number, rows: number) => {
        if (started) return;
        started = true;
        term = startShell(cols, rows);
        term.onData((d) => { try { ws.send(d); } catch { /* */ } });
        term.onExit(() => { try { ws.close(); } catch { /* */ } });
      };

      ws.on('message', (raw: Buffer) => {
        let msg: ClientMsg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'resize') {
          ensureStarted(msg.cols ?? 80, msg.rows ?? 24);
          term?.resize(msg.cols ?? 80, msg.rows ?? 24);
        } else if (msg.type === 'data' && typeof msg.data === 'string') {
          ensureStarted(80, 24);
          term?.write(msg.data);
        }
      });

      ws.on('close', () => { term?.kill(); });
      ws.on('error', () => { term?.kill(); });
    })();
  });
}
