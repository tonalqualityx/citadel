'use client';

import { ArrowRight } from 'lucide-react';

// A group of full-width choice buttons (.choices). One is pressed at a time; every choice is a
// 48px target. `line` is the small text under a choice label. `label` names the group for
// assistive tech, so the prompt text is not repeated on the page.
export interface ChoiceOption {
  key: string;
  label: string;
  line?: string;
}

export function ChoiceList({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <div className="choices" role="group" aria-label={label} data-name={name}>
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <button key={o.key} type="button" aria-pressed={selected} onClick={() => onChange(o.key)}>
            <ArrowRight className="i" aria-hidden="true" focusable="false" />
            <b>{o.label}</b>
            {o.line ? <small>{o.line}</small> : null}
          </button>
        );
      })}
    </div>
  );
}
