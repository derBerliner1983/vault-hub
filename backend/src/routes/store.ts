import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../middleware/auth';
import { readManifestsSafe } from './plugins';

// Store-Quelle ist konfigurierbar, damit der Store später „umziehen" kann.
//  - STORE_URL:   vollständige URL zur registry.json (höchste Priorität)
//  - STORE_REPO:  "owner/repo" → https://raw.githubusercontent.com/owner/repo/main/registry.json
//  - Fallback:    gebündelte store/registry.json, die mit dem Vault-Hub-Repo mitkommt
const STORE_URL = process.env.STORE_URL || '';
const STORE_REPO = process.env.STORE_REPO || '';

interface RegistryItem {
  id: string;
  name: string;
  version: string;          // Pflicht: erlaubt den Update-Vergleich
  type?: 'app' | 'extension';
  source: string;           // github:owner/repo[/subpath] oder git-URL
  description?: string | Record<string, string>;   // lokalisierbar (modulare Sprache)
  icon?: string;
  permissions?: string[];
  i18n?: Record<string, Record<string, string>>;   // modulare Sprach-Variablen der App
}

function bundledRegistryPath(): string {
  // dist liegt unter backend/dist/routes → Repo-Wurzel ist drei Ebenen höher
  const candidates = [
    path.join(__dirname, '../../../store/registry.json'),
    path.join(process.cwd(), '../store/registry.json'),
    path.join(process.cwd(), 'store/registry.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

/** Semver-artiger Vergleich: >0 wenn a neuer als b. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/[^0-9.]/g, '').split('.').map((n) => parseInt(n) || 0);
  const pb = b.replace(/[^0-9.]/g, '').split('.').map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function loadRegistry(): Promise<{ items: RegistryItem[]; error?: string }> {
  const url = STORE_URL || (STORE_REPO ? `https://raw.githubusercontent.com/${STORE_REPO}/main/registry.json` : '');
  if (url) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'vault-hub' } });
      if (!res.ok) return { items: [], error: `Store nicht erreichbar (HTTP ${res.status})` };
      const data = await res.json() as { apps?: RegistryItem[] };
      return { items: Array.isArray(data.apps) ? data.apps : [] };
    } catch (e) {
      return { items: [], error: e instanceof Error ? e.message : 'Store nicht erreichbar' };
    }
  }
  // Gebündelte Registry (kommt mit dem Repo mit)
  try {
    const raw = await fsp.readFile(bundledRegistryPath(), 'utf8');
    const data = JSON.parse(raw) as { apps?: RegistryItem[] };
    return { items: Array.isArray(data.apps) ? data.apps : [] };
  } catch {
    return { items: [] };
  }
}

export async function storeRoutes(fastify: FastifyInstance) {
  fastify.get('/api/store', { preHandler: requireAuth }, async (_req, reply) => {
    const { items, error } = await loadRegistry();
    const installed = await readManifestsSafe();
    const instMap = new Map(installed.map((p) => [p.id, p.version]));

    const merged = items.map((it) => {
      const installedVersion = instMap.get(it.id);
      return {
        ...it,
        installed: installedVersion !== undefined,
        installedVersion,
        updateAvailable: installedVersion !== undefined && compareVersions(it.version, installedVersion) > 0,
      };
    });

    reply.send({ items: merged, error, source: STORE_URL || STORE_REPO || 'bundled' });
  });
}
