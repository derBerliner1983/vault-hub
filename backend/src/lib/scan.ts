// Gemeinsame Logik für „welche Ports sind erreichbar?" – wird sowohl lokal
// (Node) als auch entfernt (Container per docker exec, Gerät per SSH) genutzt.

// Häufige Dienst-Ports, die wir standardmäßig prüfen. Nur Treffer werden gezeigt.
export const DEFAULT_SCAN_PORTS = [
  22, 21, 25, 53, 80, 81, 111, 143, 443, 445, 587, 993,
  1194, 1880, 2049, 3000, 3001, 3306, 5000, 5432, 5900, 6379,
  7878, 8000, 8006, 8080, 8081, 8096, 8123, 8443, 8989, 9000,
  9090, 9091, 19999, 27017, 32400, 51820, 61208,
];

export function sanitizePorts(input: unknown): number[] {
  if (Array.isArray(input) && input.length) {
    const ps = input.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
    return [...new Set(ps)].slice(0, 200);
  }
  return DEFAULT_SCAN_PORTS;
}

// Remote-Shell-Skript: prüft die Portliste (bevorzugt python3 nebenläufig,
// sonst nc / bash-/dev/tcp) und gibt je offenem Port eine Zeile "OPEN <port>".
export function scanScript(host: string, ports: number[]): string {
  const pyList = ports.join(',');
  const shList = ports.join(' ');
  return (
    `if command -v python3 >/dev/null 2>&1; then\n` +
    `python3 -c "\n` +
    `import socket\n` +
    `from concurrent.futures import ThreadPoolExecutor\n` +
    `h='${host}'\n` +
    `ps=[${pyList}]\n` +
    `def chk(p):\n` +
    `    s=socket.socket(); s.settimeout(1.0)\n` +
    `    try:\n` +
    `        return p if s.connect_ex((h,p))==0 else None\n` +
    `    except Exception:\n` +
    `        return None\n` +
    `    finally:\n` +
    `        s.close()\n` +
    `[print('OPEN',r) for r in ThreadPoolExecutor(30).map(chk,ps) if r]\n` +
    `"\n` +
    `else\n` +
    `for p in ${shList}; do\n` +
    `  if command -v nc >/dev/null 2>&1; then nc -w 1 -z "${host}" "$p" >/dev/null 2>&1 && echo "OPEN $p";\n` +
    `  elif command -v bash >/dev/null 2>&1; then timeout 1 bash -c "exec 3<>/dev/tcp/${host}/$p" >/dev/null 2>&1 && echo "OPEN $p"; fi\n` +
    `done\n` +
    `fi`
  );
}

export function parseOpenPorts(out: string): number[] {
  const set = new Set<number>();
  for (const m of out.matchAll(/OPEN\s+(\d+)/g)) {
    const p = Number(m[1]);
    if (p >= 1 && p <= 65535) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}
