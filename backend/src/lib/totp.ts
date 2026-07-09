import crypto from 'crypto';

// RFC 4648 base32 alphabet (no padding for secrets)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Generate a random base32 TOTP secret (default 20 bytes / 160 bit). */
export function generateSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) {
    const val = B32.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Compute a TOTP code for a given time step (RFC 6238, SHA-1, 6 digits, 30s). */
function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Verify a TOTP token, allowing ±1 time step (clock drift tolerance).
 */
export function verifyToken(secret: string, token: string, window = 1): boolean {
  if (!token) return false;
  const cleaned = token.replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (hotp(key, step + w) === cleaned) return true;
  }
  return false;
}

/** Build an otpauth:// URI for authenticator apps (Google Authenticator, Aegis, …). */
export function otpauthUrl(secret: string, account: string, issuer = 'Vault-Hub'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
