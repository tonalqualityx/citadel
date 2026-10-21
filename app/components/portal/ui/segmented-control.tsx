import type { LucideIcon } from 'lucide-react';

// A row of toggle buttons with aria-pressed. 44px targets.
export function SegmentedControl({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: string; label: string; icon?: LucideIcon }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {Icon ? <Icon className="i" aria-hidden="true" focusable="false" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
