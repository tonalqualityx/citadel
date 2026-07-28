import { cn } from '@/lib/utils/cn';
import type { ReasonChip as ReasonChipData, ReasonChipVariant } from '@/lib/reason-chips';

interface ReasonChipProps {
  chip: ReasonChipData;
  className?: string;
}

// Clarity Phase 8 (composition) — the one honest reason chip (see lib/reason-chips.ts for
// the rule table this renders). Four variants, mapped 1:1 from the approved wireframe:
// "progress" and "promised" are assertive filled treatments (the accent color, promised
// using its own darker-text-on-accent so it reads distinctly "this was a real promise");
// "target" and "picked" are the SAME quiet outline treatment — deliberately never red,
// never the word "overdue" (research DON'T-BUILD law + DAY-REALITY #3).
const VARIANT_CLASSES: Record<ReasonChipVariant, { chip: string; dot: string }> = {
  progress: {
    chip: 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)] border-transparent',
    dot: 'bg-[color:var(--accent)]',
  },
  promised: {
    chip: 'bg-[color:var(--accent)] text-[#12242f] border-transparent',
    dot: 'bg-[#12242f]',
  },
  target: {
    chip: 'bg-transparent text-text-sub border-border-warm',
    dot: 'ring-1 ring-inset ring-text-sub',
  },
  picked: {
    chip: 'bg-transparent text-text-sub border-border-warm',
    dot: 'ring-1 ring-inset ring-text-sub',
  },
};

export function ReasonChip({ chip, className }: ReasonChipProps) {
  const styles = VARIANT_CLASSES[chip.variant];
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold',
        styles.chip,
        className
      )}
      data-testid="reason-chip"
      data-variant={chip.variant}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', styles.dot)} aria-hidden="true" />
      {chip.label}
    </span>
  );
}
