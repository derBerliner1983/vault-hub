const stateMap: Record<string, string> = {
  running: 'running',
  stopped: 'stopped',
  exited: 'exited',
  restarting: 'restarting',
  paused: 'paused',
  dead: 'dead',
  created: 'stopped',
};

const labelMap: Record<string, string> = {
  running: 'Läuft',
  stopped: 'Gestoppt',
  exited: 'Beendet',
  restarting: 'Neustart',
  paused: 'Pausiert',
  dead: 'Fehler',
  created: 'Erstellt',
};

export function ContainerBadge({ state }: { state: string }) {
  const key = stateMap[state.toLowerCase()] ?? 'stopped';
  const label = labelMap[state.toLowerCase()] ?? state;
  return (
    <span className={`badge badge--${key}`}>
      <span className="badge__dot" />
      {label}
    </span>
  );
}
