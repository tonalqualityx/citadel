'use client';

// A radio group in a fieldset. Native radios give arrow-key movement and Space to select;
// every choice is a 44px target. `line` is the small text under a choice label.
export interface ChoiceOption {
  key: string;
  label: string;
  line?: string;
}

export function ChoiceList({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const id = `${name}-${o.key}`;
        const selected = value === o.key;
        return (
          <label
            key={o.key}
            htmlFor={id}
            className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
              selected ? 'border-brand-primary bg-surface-secondary' : 'border-border bg-surface hover:bg-surface-secondary'
            }`}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={o.key}
              checked={selected}
              onChange={() => onChange(o.key)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block font-medium text-text-main">{o.label}</span>
              {o.line && <span className="block text-sm text-text-secondary">{o.line}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
