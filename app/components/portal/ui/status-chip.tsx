import type { ChipTone } from '@/lib/portal/status-labels';
import { TONE_ICON } from './icons';

export type ChipProps = { label: string; tone: ChipTone };

// State is always an icon plus a word, never color alone. Tones and labels live in
// lib/portal/status-labels.ts. A chip is never a link or a button.
export function StatusChip({ label, tone }: ChipProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span className="chip" data-tone={tone}>
      <Icon className="i" aria-hidden="true" focusable="false" />
      {label}
    </span>
  );
}
