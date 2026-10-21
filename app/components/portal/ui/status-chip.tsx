import type { ChipTone } from '@/lib/portal/status-labels';

// Status is always a word; the dot is the second channel (aria-hidden). Tones and labels live in
// lib/portal/status-labels.ts. Slice 3 restyles this with the portal tokens.
const DOT: Record<ChipTone, string> = {
  attention: 'bg-warning',
  moving: 'bg-primary',
  done: 'bg-success',
  quiet: 'bg-text-muted',
  urgent: 'bg-error',
  quote: 'bg-foreground',
};

export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span
      data-tone={tone}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-alt px-2.5 py-0.5 text-xs font-semibold text-text-main"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  );
}
