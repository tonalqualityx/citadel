'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/hooks/use-now';
import { useCronChipStates, useSnoozeCron, useDismissCron } from '@/lib/hooks/use-cron-chips';
import { cronKey, visibleCronChips } from '@/lib/cron-chips';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { erroringCrons, type ErroringCron } from './oracle-logic';

interface CronHealthLineProps {
  machines: OracleMachineDTO[];
  /** Seeing Stone's header pairs this line with a preceding date string via a literal
   *  "· " on the healthy branch; Fleet's header has no leading text, so it omits the
   *  bullet there. Defaults on (Seeing Stone's original behavior). */
  bullet?: boolean;
}

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q14) — cron chips v1. A single erroring
// cron earns its own quiet chip (not a bundled sentence): click it to see the last-run
// detail (attention_reason — the only "last run" signal the fleet heartbeat currently
// carries) plus Snooze (hide until tomorrow) / Dismiss (hide until this cron's failure
// message actually changes — a "re-fire"). No run-now this phase (no trigger plumbing
// exists yet). Healthy crons still render nothing at all — exception-based display is
// unchanged.
function CronChip({ cron }: { cron: ErroringCron }) {
  const [open, setOpen] = React.useState(false);
  const snooze = useSnoozeCron();
  const dismiss = useDismissCron();
  const key = cronKey(cron.machineName, cron.title);

  function handleSnooze() {
    snooze.mutate(key);
    setOpen(false);
  }

  function handleDismiss() {
    dismiss.mutate(key, cron.attentionReason ?? null);
    setOpen(false);
  }

  return (
    <div className="relative inline-block" data-testid="cron-chip">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full border border-[color:var(--warning)]/40 px-1.5 py-0.5 font-semibold text-[var(--warning)] hover:bg-[color:var(--warning)]/10"
        data-testid="cron-chip-trigger"
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {cron.title}
      </button>

      {open && (
        <div
          className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-border-warm bg-surface p-2.5 text-left shadow-md"
          data-testid="cron-chip-popover"
        >
          <p className="text-xs font-semibold text-text-main">{cron.title}</p>
          <p className="mt-0.5 text-xs text-text-sub">on {cron.machineName}</p>
          <p className="mt-1.5 text-xs text-text-main" data-testid="cron-chip-reason">
            {cron.attentionReason ?? 'No detail reported.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" onClick={handleSnooze} disabled={snooze.isPending}>
              Snooze
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={dismiss.isPending}>
              Dismiss
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CronHealthLine({ machines, bullet = true }: CronHealthLineProps) {
  const nowMs = useNow(60_000);
  const { data } = useCronChipStates();
  const crons = React.useMemo(
    () => visibleCronChips(erroringCrons(machines), data?.states ?? [], nowMs),
    [machines, data?.states, nowMs]
  );

  if (crons.length === 0) {
    return <span>{bullet ? '· ' : ''}all crons healthy</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="cron-health-warning">
      {crons.map((cron) => (
        <CronChip key={cronKey(cron.machineName, cron.title)} cron={cron} />
      ))}
    </span>
  );
}
