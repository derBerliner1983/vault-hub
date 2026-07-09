import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Verschlüsselung sensibler Daten (z. B. SSH-Zugänge) mit AES-256-GCM.
// Der Schlüssel kommt entweder aus CORE_HUB_SECRET (ENV) oder – bevorzugt –
// aus einer einmalig erzeugten Schlüsseldatei mit strengen Rechten (0600).
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const KEY_PATH = path.join(DATA_DIR, 'secret.key');

function loadKey(): Buffer {
  if (process.env.CORE_HUB_SECRET) {
    return crypto.createHash('sha256').update(process.env.CORE_HUB_SECRET).digest();
  }
  try {
    const raw = fs.readFileSync(KEY_PATH);
    if (raw.length >= 32) return raw.subarray(0, 32);
  } catch { /* Datei fehlt – neu erzeugen */ }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  try { fs.chmodSync(KEY_PATH, 0o600); } catch { /* Windows/ohne chmod */ }
  return key;
}

const KEY = loadKey();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string {
  const [v, ivb, tagb, encb] = blob.split(':');
  if (v !== 'v1' || !ivb || !tagb || !encb) throw new Error('Ungültiges Secret-Format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivb, 'base64'));
  decipher.setAuthTag(Buffer.from(tagb, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encb, 'base64')), decipher.final()]).toString('utf8');
}
