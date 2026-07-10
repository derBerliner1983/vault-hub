import { tt } from '../../lib/i18n';
interface SparklineProps {
  data: number[];
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({
  data, max = 100, width = 600, height = 80, color = 'var(--color-warning)', fill = true,
}: SparklineProps) {
  if (data.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-faint)', fontSize: 12 }}>{tt('Sammle Daten…')}</div>;
  }

  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - (Math.min(v, max) / max) * (height - 4) - 2;
    return [x, y];
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map((g) => {
        const y = height - (g / 100) * (height - 4) - 2;
        return <line key={g} x1={0} y1={y} x2={width} y2={y} stroke="var(--color-border)" strokeWidth={1} />;
      })}
      {fill && <path d={area} fill={color} opacity={0.08} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
