import { execSync, execFileSync, type ExecSyncOptions } from 'child_process';

/** True if the Node process already runs as root (uid 0). */
export const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;

/**
 * Run a shell command, automatically prefixing `sudo -n` when not running as
 * root. The install.sh sets up /etc/sudoers.d/vault-hub so this works without a
 * password for the whitelisted binaries.
 */
export function privExec(cmd: string, opts: ExecSyncOptions = {}): string {
  const full = isRoot ? cmd : `sudo -n ${cmd}`;
  return execSync(full, { timeout: 15000, ...opts }).toString();
}

/** execFile variant (no shell parsing) with optional sudo prefix. */
export function privExecFile(bin: string, args: string[], opts: ExecSyncOptions = {}): string {
  if (isRoot) {
    return execFileSync(bin, args, { timeout: 15000, ...opts }).toString();
  }
  return execFileSync('sudo', ['-n', bin, ...args], { timeout: 15000, ...opts }).toString();
}

/** Best-effort command that never throws; returns '' on failure. */
export function safeExec(cmd: string, timeout = 6000): string {
  try {
    return execSync(cmd, { timeout, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/** Check whether a binary exists in PATH. */
export function hasBinary(bin: string): boolean {
  return safeExec(`command -v ${bin.replace(/[^a-zA-Z0-9_-]/g, '')} 2>/dev/null`).trim().length > 0;
}
