'use client';

import { ChoiceList } from '@/components/portal/intake/choice-list';

// The choices Bast offers: pages, sections, sites, files, or the urgent options. The same full-width
// 48px buttons the stepper uses. Pressing one sends it straight away; labels come from the server.
export function ChoiceButtons({
  slot, label, choices, disabled, onChoose,
}: {
  slot: string;
  label: string;
  choices: Array<{ id: string; label: string }>;
  disabled?: boolean;
  onChoose: (slot: string, id: string, label: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="chat-choices" data-testid={`chat-choices-${slot}`} aria-disabled={disabled || undefined}>
      <ChoiceList
        name={`chat-${slot}`}
        label={label}
        options={choices.map((c) => ({ key: c.id, label: c.label }))}
        value={null}
        onChange={(id) => {
          if (disabled) return;
          const c = choices.find((x) => x.id === id);
          if (c) onChoose(slot, id, c.label);
        }}
      />
    </div>
  );
}
