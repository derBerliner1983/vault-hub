import net from 'node:net';
import Dockerode from 'dockerode';
import { Client } from 'ssh2';
import { db } from '../db/index';
import { decryptSecret } from './secrets';
import { scanScript, parseOpenPorts } from './scan';

// Gemeinsame Scan-Bausteine (lokal / aus Container / aus entferntem Gerät),
// genutzt von den synchronen Endpunkten und der Hintergrund-Stapelverarbeitung.
const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Nebenläufiger TCP-Scan vom Server aus.
export async function scanHostTcp(host: string, ports: number[], concurrency = 80, timeout = 800): Promise<number[]> {
  const open: number[] = [];
  let idx = 0;
  const probeOne = (port: number) => new Promise<boolean>((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const fin = (ok: boolean) => { if (done) return; done = true; try { sock.destroy(); } catch { /* */ } resolve(ok); };
    sock.setTimeout(timeout);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
    sock.connect(port, host);
  });
  const worker = async () => { while (idx < ports.length) { const p = ports[idx++]; if (await probeOne(p)) open.push(p); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, () => worker()));
  return open.sort((a, b) => a - b);
}

// Scan aus einem Container heraus (docker exec).
export async function scanViaExec(container: string, host: string, ports: number[]): Promise<number[]> {
  const c = docker.getContainer(container);
  const exec = await c.exec({ Cmd: ['sh', '-c', scanScript(host, ports)], AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    stream.on('data', (d: Buffer) => chunks.push(d));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
  return parseOpenPorts(out.replace(/[\x00-\x08\x0e-\x1f]/g, ''));
}

interface SshRow { host: string; port: number; username: string; auth_type: 'password' | 'key'; secret_enc: string; passphrase_enc: string | null; }

// Scan aus einem entfernten Gerät heraus (SSH → TCP zu host).
export async function scanViaSsh(nodeId: string, host: string, ports: number[]): Promise<number[]> {
  const row = db.prepare('SELECT host, port, username, auth_type, secret_enc, passphrase_enc FROM ssh_targets WHERE node_id = ?').get(nodeId) as SshRow | undefined;
  if (!row) return [];
  const cfg = row.auth_type === 'key'
    ? { host: row.host, port: row.port || 22, username: row.username, readyTimeout: 8000, privateKey: decryptSecret(row.secret_enc), passphrase: row.passphrase_enc ? decryptSecret(row.passphrase_enc) : undefined }
    : { host: row.host, port: row.port || 22, username: row.username, readyTimeout: 8000, password: decryptSecret(row.secret_enc) };
  const out = await new Promise<string>((resolve) => {
    const conn = new Client();
    let done = false;
    const fin = (s: string) => { if (done) return; done = true; try { conn.end(); } catch { /* */ } resolve(s); };
    conn.on('ready', () => {
      conn.exec(scanScript(host, ports), (err, stream) => {
        if (err) return fin('');
        let o = '';
        stream.on('data', (d: Buffer) => { o += d.toString(); });
        stream.stderr.on('data', () => { /* */ });
        stream.on('close', () => fin(o));
      });
    });
    conn.on('error', () => fin(''));
    try { conn.connect(cfg); } catch { fin(''); }
  });
  return parseOpenPorts(out);
}
