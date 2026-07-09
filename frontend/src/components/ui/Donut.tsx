interface Segment {
  value: number;
  color: string;
  label?: string;
}

interface DonutProps {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
  centerColor?: string;
}

export function Donut({
  segments, size = 130, thickness = 14, centerLabel, centerSub, centerColor,
}: DonutProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const fraction = seg.value / total;
    const dash = fraction * circumference;
    const arc = (
      <circle
        key={i}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={seg.color}
        strokeWidth={thickness}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        strokeLinecap={fraction > 0.02 && fraction < 0.98 ? 'butt' : 'round'}
        style={{ transition: 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease' }}
      />
    );
    offset += dash;
    return arc;
  });

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--color-border-strong)" strokeWidth={thickness} opacity={0.25}
        />
        {arcs}
      </svg>
      {centerLabel && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: size * 0.2, fontWeight: 800, letterSpacing: '-0.03em', color: centerColor ?? 'var(--color-fg)', lineHeight: 1 }}>
            {centerLabel}
          </span>
          {centerSub && <span style={{ fontSize: 10, color: 'var(--color-subtle)', marginTop: 2 }}>{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

export function donutColor(percent: number): string {
  if (percent >= 90) return 'var(--color-error)';
  if (percent >= 75) return 'var(--color-warning)';
  return 'var(--color-accent)';
}
