'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Tooltip } from '@/components/ui/tooltip';
import { CronHealthLine } from '@/components/domain/oracle/CronHealthLine';
import { dueLabel } from '@/lib/reason-chips';
import type { OracleMachineDTO, OracleSessionWithMachine } from '@/lib/types/oracle';
import type { OracleMode } from '../mode-shell-logic';
import { buildSignals, SIGNALS_EMPTY_COPY, type Signal, type SignalKind } from './signals-rail-logic';

export interface PromisedDueTodayTask {
  id: string;
  title: string;
  due_date: string;
  promised_to: string | null;
}

interface SignalsRailProps {
  crisisCount: number;
  promisedDueTodayTasks: PromisedDueTodayTask[];
  sessionsNeedingYou: OracleSessionWithMachine[];
  machines: OracleMachineDTO[];
  todayDateStr: string;
  onGoToMode: (mode: OracleMode) => void;
}

const TONE_CLASSES: Record<Signal['tone'], string> = {
  error: 'text-[color:var(--error)]',
  warning: 'text-[color:var(--warning)]',
  quiet: 'text-text-sub',
};

// Clarity Phase 8 (shakedown round 2) — the information-scent law: every chip carries its
// action, and the tooltip states it up front so it never has to be discovered by clicking.
const SIGNAL_TOOLTIP: Record<SignalKind, string> = {
  crisis: 'Scrolls down to the crisis strip',
  promised_due_today: 'Click to see which tasks, and jump to the board',
  session_needs_you: 'Click to see which sessions, and jump to Fleet',
};

function scrollToCrisisStrip() {
  document.querySelector('[data-testid="crisis-strip"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Clarity Phase 8 (composition) — Work mode's signals rail: quiet by default, lights only
// for crisis / promised-due-today / sessions-needing-you. The empty state's sentence is
// spec-binding (DAY-REALITY #6) — earned by the capture system, rendered verbatim.
//
// Clarity Phase 8 (shakedown round 2) — chips become doors (information-scent law): crisis
// scrolls to the on-page crisis strip; promised-due-today and sessions-needing-you expand
// inline into the actual list (title + what it's waiting on + a way in), never just a
// number with nowhere to go.
export function SignalsRail({
  crisisCount,
  promisedDueTodayTasks,
  sessionsNeedingYou,
  machines,
  todayDateStr,
  onGoToMode,
}: SignalsRailProps) {
  const [expanded, setExpanded] = React.useState<SignalKind | null>(null);
  const signals = buildSignals({
    crisisCount,
    promisedDueTodayCount: promisedDueTodayTasks.length,
    sessionsNeedingYouCount: sessionsNeedingYou.length,
  });

  function handleChipClick(kind: SignalKind) {
    if (kind === 'crisis') {
      scrollToCrisisStrip();
      return;
    }
    setExpanded((cur) => (cur === kind ? null : kind));
  }

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
            <Tooltip key={s.kind} content={SIGNAL_TOOLTIP[s.kind]}>
              <button
                type="button"
                onClick={() => handleChipClick(s.kind)}
                aria-expanded={s.kind === 'crisis' ? undefined : expanded === s.kind}
                className={cn('flex items-center gap-1 text-sm font-medium hover:underline', TONE_CLASSES[s.tone])}
                data-testid={`signal-${s.kind}`}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {s.label}
                {s.kind !== 'crisis' &&
                  (expanded === s.kind ? (
                    <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ))}
              </button>
            </Tooltip>
          ))
        )}
      </div>

      {expanded === 'promised_due_today' && promisedDueTodayTasks.length > 0 && (
        <div
          className="flex flex-col gap-1.5 rounded-lg border border-border-warm bg-surface p-3"
          data-testid="signal-promised_due_today-panel"
        >
          {promisedDueTodayTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid="signal-promised-task-item"
            >
              <span className="min-w-0 truncate text-text-main">{task.title}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-text-sub">due {dueLabel(task.due_date, todayDateStr)}</span>
                <button
                  type="button"
                  onClick={() => onGoToMode('plan')}
                  className="rounded-md border border-border-warm px-2 py-0.5 text-xs font-medium text-text-main hover:border-[color:var(--accent)]"
                  data-testid="signal-promised-task-focus"
                >
                  Focus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded === 'session_needs_you' && sessionsNeedingYou.length > 0 && (
        <div
          className="flex flex-col gap-1.5 rounded-lg border border-border-warm bg-surface p-3"
          data-testid="signal-session_needs_you-panel"
        >
          {sessionsNeedingYou.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid="signal-session-item"
            >
              <div className="min-w-0">
                <p className="truncate text-text-main">{session.title ?? session.external_id}</p>
                {(session.waiting_on || session.attention_reason) && (
                  <p className="truncate text-xs text-text-sub">{session.waiting_on ?? session.attention_reason}</p>
                )}
              </div>
              {session.remote_url ? (
                <a
                  href={session.remote_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-border-warm px-2 py-0.5 text-xs font-medium text-text-main hover:border-[color:var(--accent)]"
                  data-testid="signal-session-link"
                >
                  Open session
                </a>
              ) : (
                <Link
                  href="/oracle/fleet"
                  className="shrink-0 rounded-md border border-border-warm px-2 py-0.5 text-xs font-medium text-text-main hover:border-[color:var(--accent)]"
                  data-testid="signal-session-link"
                >
                  View on Fleet
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Cron chips are a signal, not a separate region — CronHealthLine already renders
          nothing when every cron is healthy/snoozed/dismissed. */}
      <CronHealthLine machines={machines} bullet={false} />
    </div>
  );
}
