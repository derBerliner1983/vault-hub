import Dockerode from 'dockerode';
import { notify } from './notify';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

/**
 * Subscribe to the Docker event stream and raise a notification when a
 * container dies with a non-zero exit code (crash / OOM). Reconnects on error.
 */
export function startDockerWatcher(): void {
  docker.getEvents({ filters: { type: ['container'], event: ['die'] } }, (err, stream) => {
    if (err || !stream) {
      // Docker not available – retry later, quietly
      setTimeout(startDockerWatcher, 30_000);
      return;
    }
    stream.on('data', (chunk: Buffer) => {
      try {
        const ev = JSON.parse(chunk.toString());
        const exit = ev?.Actor?.Attributes?.exitCode;
        const name = ev?.Actor?.Attributes?.name || ev?.id?.slice(0, 12) || 'container';
        if (exit && exit !== '0') {
          void notify('error', `Container „${name}" beendet`, `Exit-Code ${exit} – der Container ist unerwartet gestoppt.`, 'container');
        }
      } catch { /* malformed event – ignore */ }
    });
    stream.on('error', () => setTimeout(startDockerWatcher, 30_000));
    stream.on('close', () => setTimeout(startDockerWatcher, 30_000));
    stream.on('end', () => setTimeout(startDockerWatcher, 30_000));
  });
}
