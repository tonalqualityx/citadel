'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { CronHealthLine } from '@/components/domain/oracle/CronHealthLine';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { buildSignals, SIGNALS_EMPTY_COPY, type Signal } from './signals-rail-logic';

interface SignalsRailProps {
  crisisCount: number;
  promisedDueTodayCount: number;
  sessionsNeedingYouCount: number;
  machines: OracleMachineDTO[];
}

const TONE_CLASSES: Record<Signal['tone'], string> = {
  error: 'text-[color:var(--error)]',
  warning: 'text-[color:var(--warning)]',
  quiet: 'text-text-sub',
};

// Clarity Phase 8 (composition) — Work mode's signals rail: quiet by default, lights only
// for crisis / promised-due-today / sessions-needing-you. The empty state's sentence is
// spec-binding (DAY-REALITY #6) — earned by the capture system, rendered verbatim.
export function SignalsRail({ crisisCount, promisedDueTodayCount, sessionsNeedingYouCount, machines }: SignalsRailProps) {
  const signals = buildSignals({ crisisCount, promisedDueTodayCount, sessionsNeedingYouCount });

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border-warm bg-surface px-4 py-3"
        data-testid="signals-rail"
      >
        {signals.length === 0 ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
            <span className="text-sm text-text-sub" data-testid="signals-empty-copy">
              {SIGNALS_EMPTY_COPY}
            </span>
          </>
        ) : (
          signals.map((s) => (
            <span
              key={s.kind}
              className={cn('flex items-center gap-1.5 text-sm font-medium', TONE_CLASSES[s.tone])}
              data-testid={`signal-${s.kind}`}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {s.label}
            </span>
          ))
        )}
      </div>
      {/* Cron chips are a signal, not a separate region — CronHealthLine already renders
          nothing when every cron is healthy/snoozed/dismissed. */}
      <CronHealthLine machines={machines} bullet={false} />
    </div>
  );
}
