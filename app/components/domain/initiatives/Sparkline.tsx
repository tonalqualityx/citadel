import type { BoardNumber } from '@/lib/hooks/use-initiatives';
import { formatValue } from './format';

const W = 112;
const H = 28;
const PAD = 3;

/**
 * The last 12 readings as a line, with the target as a dashed line (design.md 3.1). With no readings yet it shows the
 * target line alone; the label says so for a screen reader.
 */
export function Sparkline({ number }: { number: BoardNumber }) {
  const values = number.readings.map((r) => r.value);
  const target = number.target_value;
  const pool = [...values, ...(target !== null ? [target] : []), ...(number.baseline_value !== null ? [number.baseline_value] : [])];
  const min = pool.length ? Math.min(...pool) : 0;
  const max = pool.length ? Math.max(...pool) : 1;
  const span = max - min || 1;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const x = (i: number) => (values.length <= 1 ? W / 2 : PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const label = values.length
    ? `${values.length} readings, last ${formatValue(values[values.length - 1], number.unit)}, target ${formatValue(target, number.unit)}`
    : `No readings yet, target ${formatValue(target, number.unit)}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="overflow-visible">
      {target !== null ? (
        <line x1={PAD} x2={W - PAD} y1={y(target)} y2={y(target)} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
      ) : null}
      {values.length > 1 ? <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {values.length ? <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill="var(--accent)" /> : null}
    </svg>
  );
}
