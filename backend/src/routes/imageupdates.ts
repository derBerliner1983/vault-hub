import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth } from '../middleware/auth';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

interface ParsedImage {
  registry: string;
  repo: string;
  tag: string;
}

/** Parse a docker image reference into registry / repo / tag. */
function parseImage(image: string): ParsedImage {
  let ref = image.split('@')[0]; // drop any digest
  let registry = 'registry-1.docker.io';
  let path = ref;

  const firstSlash = ref.indexOf('/');
  const firstPart = firstSlash === -1 ? '' : ref.slice(0, firstSlash);
  if (firstPart && (firstPart.includes('.') || firstPart.includes(':') || firstPart === 'localhost')) {
    registry = firstPart;
    path = ref.slice(firstSlash + 1);
  }

  let tag = 'latest';
  const colon = path.lastIndexOf(':');
  if (colon !== -1) {
    tag = path.slice(colon + 1);
    path = path.slice(0, colon);
  }
  // Docker Hub official images live under library/
  if (registry === 'registry-1.docker.io' && !path.includes('/')) {
    path = `library/${path}`;
  }
  return { registry, repo: path, tag };
}

const ACCEPT_MANIFEST = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ');

/** Fetch the current manifest digest of an image tag from its registry. */
async function remoteDigest(p: ParsedImage): Promise<string | null> {
  const url = `https://${p.registry}/v2/${p.repo}/manifests/${encodeURIComponent(p.tag)}`;
  const controller = AbortSignal.timeout(8000);
  try {
    let res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT_MANIFEST }, signal: controller });
    if (res.status === 401) {
      const auth = res.headers.get('www-authenticate') ?? '';
      const realm = /realm="([^"]+)"/.exec(auth)?.[1];
      const service = /service="([^"]+)"/.exec(auth)?.[1];
      const scope = /scope="([^"]+)"/.exec(auth)?.[1] ?? `repository:${p.repo}:pull`;
      if (realm) {
        const tokenUrl = `${realm}?service=${encodeURIComponent(service ?? '')}&scope=${encodeURIComponent(scope)}`;
        const tok = (await fetch(tokenUrl, { signal: AbortSignal.timeout(8000) }).then((r) => r.json())) as { token?: string; access_token?: string };
        const bearer = tok.token ?? tok.access_token;
        res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT_MANIFEST, Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000) });
      }
    }
    return res.headers.get('docker-content-digest');
  } catch {
    return null;
  }
}

export async function imageUpdateRoutes(fastify: FastifyInstance) {
  fastify.get('/api/containers/updates', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const containers = await docker.listContainers({ all: false });
      const cache = new Map<string, string | null>();
      const result: Record<string, { hasUpdate: boolean | null; image: string }> = {};

      await Promise.all(
        containers.map(async (c) => {
          const info = await docker.getContainer(c.Id).inspect().catch(() => null);
          if (!info) return;
          const image = info.Config.Image;

          // RepoDigests live on the image, not the container
          const imgInfo = await docker.getImage(info.Image).inspect().catch(() => null);
          const repoDigests: string[] = imgInfo?.RepoDigests ?? [];
          const localDigest = (repoDigests[0] ?? '').split('@')[1] ?? '';

          const p = parseImage(image);
          const cacheKey = `${p.registry}/${p.repo}:${p.tag}`;
          if (!cache.has(cacheKey)) cache.set(cacheKey, await remoteDigest(p));
          const remote = cache.get(cacheKey) ?? null;

          const hasUpdate: boolean | null = remote && localDigest ? remote !== localDigest : null;
          result[c.Id] = { hasUpdate, image };
        })
      );

      reply.send({ updates: result });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });
}
