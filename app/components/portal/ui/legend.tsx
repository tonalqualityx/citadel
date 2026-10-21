export type LegendEntry = { swatch: 'kind' | 'state' | 'icon'; value: string; label: string; icon?: React.ReactNode };

// A key. `value` is a CSS color, a CSS background or border shorthand.
export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className="legend">
      {entries.map((e) => (
        <span key={e.label}>
          {e.icon ?? <i aria-hidden="true" style={e.swatch === 'kind' ? { background: e.value } : e.swatch === 'state' ? { background: e.value } : undefined} />}
          {e.label}
        </span>
      ))}
    </div>
  );
}
