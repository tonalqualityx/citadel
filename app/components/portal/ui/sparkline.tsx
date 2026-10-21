// A tiny area chart scaled min..max: the lowest value sits on the bottom edge, the highest on the
// top. role="img" with the label the caller supplies; the number is always printed beside it.
export function sparkPoints(series: number[], width: number, height: number, pad = 3): Array<[number, number]> {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series.map((v, i) => [
    series.length === 1 ? width / 2 : (i / (series.length - 1)) * width,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
}

export function Sparkline({ series, width = 220, height = 40, label }: { series: number[]; width?: number; height?: number; label: string }) {
  if (series.length < 2) return null;
  const pts = sparkPoints(series, width, height);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height}Z`;
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={area} fill="var(--p-spark-fill)" />
      <path d={line} fill="none" stroke="var(--p-spark)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={`M${ex} ${ey}h0`} stroke="var(--p-spark)" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
