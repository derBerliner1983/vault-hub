'use strict';
// Terminal-Plugin-Backend (CommonJS). Wird vom Vault-Hub-Kern via
// loadPluginBackends() geladen: register(fastify, ctx). Registriert eine
// WebSocket-Route unter /app/terminal/ws, die eine interaktive Shell streamt.
// Portiert von Core-Hubs terminal.ts.

const { spawn } = require('child_process');

// node-pty ist optional (native). Fehlt es, nutzen wir util-linux `script`.
let nodePty = null;
try { nodePty = require('node-pty'); } catch { nodePty = null; }

function startShell(isRoot, cols, rows) {
  const shellCmd = isRoot ? '/bin/bash' : 'sudo';
  const shellArgs = isRoot ? ['-l'] : ['-n', '/bin/bash', '-l'];
  const cwd = process.env.HOME && process.env.HOME !== '/root' ? process.env.HOME : '/';
  const env = Object.assign({}, process.env, { TERM: 'xterm-256color', LANG: process.env.LANG || 'C.UTF-8' });

  if (nodePty) {
    const term = nodePty.spawn(shellCmd, shellArgs, { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd, env });
    return {
      onData: (cb) => term.onData(cb),
      onExit: (cb) => term.onExit(cb),
      write: (d) => term.write(d),
      resize: (c, r) => { try { term.resize(c || 80, r || 24); } catch (_) { /* */ } },
      kill: () => { try { term.kill(); } catch (_) { /* */ } },
    };
  }

  const innerCmd = isRoot ? '/bin/bash -l' : 'sudo -n /bin/bash -l';
  const child = spawn('script', ['-qfc', innerCmd, '/dev/null'], {
    cwd, env: Object.assign({}, env, { COLUMNS: String(cols || 80), LINES: String(rows || 24) }),
  });
  return {
    onData: (cb) => { child.stdout.on('data', (d) => cb(d.toString())); child.stderr.on('data', (d) => cb(d.toString())); },
    onExit: (cb) => child.on('close', cb),
    write: (d) => { try { child.stdin.write(d); } catch (_) { /* */ } },
    resize: () => { /* script kann kein Live-Resize */ },
    kill: () => { try { child.kill(); } catch (_) { /* */ } },
  };
}

module.exports.register = function register(fastify, ctx) {
  fastify.get('/app/terminal/info', async (req, reply) => {
    try { await req.jwtVerify(); } catch (_) { return reply.status(401).send({ error: 'Unauthorized' }); }
    if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Admin erforderlich' });
    reply.send({ available: true, resize: !!nodePty });
  });

  fastify.get('/app/terminal/ws', { websocket: true }, (ws, req) => {
    void (async () => {
      try { await req.jwtVerify(); } catch (_) { ws.close(1008, 'Unauthorized'); return; }
      if (req.user.role !== 'admin') { ws.close(1008, 'Admin erforderlich'); return; }

      ctx.audit(req.user.id, 'terminal.open', null);

      let term = null;
      let started = false;
      const ensureStarted = (cols, rows) => {
        if (started) return;
        started = true;
        term = startShell(ctx.isRoot, cols, rows);
        term.onData((d) => { try { ws.send(d); } catch (_) { /* */ } });
        term.onExit(() => { try { ws.close(); } catch (_) { /* */ } });
      };

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        if (msg.type === 'resize') {
          ensureStarted(msg.cols || 80, msg.rows || 24);
          term && term.resize(msg.cols || 80, msg.rows || 24);
        } else if (msg.type === 'data' && typeof msg.data === 'string') {
          ensureStarted(80, 24);
          term && term.write(msg.data);
        }
      });
      ws.on('close', () => { term && term.kill(); });
      ws.on('error', () => { term && term.kill(); });
    })();
  });
};
