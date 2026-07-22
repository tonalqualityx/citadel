'use client';

import * as React from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useNow } from '@/lib/hooks/use-now';
import { useTodayPicks, useTodayCalendar } from '@/lib/hooks/use-today';
import { TODAY_PICK_WIP_CAP, isPastWarningThreshold } from '@/lib/today-picks';
import { Spinner } from '@/components/ui/spinner';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { TimeShape } from './TimeShape';
import { TodayPickCard } from './TodayPickCard';
import { TodayBoard } from './TodayBoard';
import { DueSoonRow } from './DueSoonRow';

// Clarity Phase 3d bug fix: was `.toLocaleTimeString([], {...})` — no explicit locale
// or timeZone, so this rendered in the BROWSER's implicit locale zone (silently wrong
// for anyone whose browser isn't set to their own resolved zone, and impossible to
// verify/test deterministically). Always pass the resolved requester's timezone from
// the /api/today/calendar response (see TodayCalendarResponse.timezone).
function formatPickedAt(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

interface TodaySectionProps {
  // Clarity Phase 5 — legacy needs-attention sessions (no manifest ask) linked to an arc
  // render a quiet dot on that arc's Today pick card instead of a card in Needs Reshi.
  // Optional so this section still renders sanely before fleet data has arrived.
  legacyAttentionArcIds?: Set<string>;
}

// Today: the time-shape track (meetings + chosen focus picks + now-line) followed by the
// day's picks — list or board lens, same underlying data ("cheap lens" per spec). Header
// line carries the WIP count (warning tint past 3, per the evidence-bound cap) and a quiet,
// competence-framed "done today" counter — never a streak, never a broken-chain display.
export function TodaySection({ legacyAttentionArcIds }: TodaySectionProps = {}) {
  const { t } = useTerminology();
  const nowMs = useNow(30_000);
  const { data: todayData, isLoading: picksLoading } = useTodayPicks();
  const { data: calendarData, isLoading: calendarLoading } = useTodayCalendar();
  const [lens, setLens] = React.useState<'list' | 'board'>('list');

  const isLoading = picksLoading || calendarLoading;

  const picks = todayData?.picks ?? [];
  const uncompleted = picks.filter((p) => !p.completed_at);
  const doneToday = picks.length - uncompleted.length;
  const overWarning = isPastWarningThreshold(uncompleted.length);

  const earliestPickedAt = picks.length
    ? picks.reduce((min, p) => (p.created_at < min ? p.created_at : min), picks[0].created_at)
    : null;

  const today = calendarData?.week?.[0];
  // Falls back to the client-safe default while calendarData is still loading —
  // reconciles with the resolved zone the instant the response arrives.
  const timezone = calendarData?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;

  return (
    <section className="flex flex-col gap-2" data-testid="today-section">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="text-xs font-bold uppercase tracking-wide text-text-sub">Today</h2>
        <span
          className={cn(
            'ml-auto text-xs',
            overWarning ? 'font-semibold text-[var(--warning)]' : 'text-text-sub'
          )}
        >
          <b className="text-text-main">{uncompleted.length}</b> of {TODAY_PICK_WIP_CAP} threads
          {earliestPickedAt ? ` · picked ${formatPickedAt(earliestPickedAt, timezone)}` : ''}
        </span>
        {doneToday > 0 && (
          <span className="text-xs text-text-sub" data-testid="done-today-counter">
            {doneToday} closed today
          </span>
        )}
        <div className="flex items-center gap-1 rounded-md border border-border-warm bg-surface p-0.5">
          <button
            type="button"
            onClick={() => setLens('list')}
            aria-pressed={lens === 'list'}
            aria-label="List view"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded',
              lens === 'list' ? 'bg-background-light text-text-main' : 'text-text-sub'
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLens('board')}
            aria-pressed={lens === 'board'}
            aria-label="Board view"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded',
              lens === 'board' ? 'bg-background-light text-text-main' : 'text-text-sub'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size="md" />
        </div>
      ) : (
        <>
          {calendarData && (
            <TimeShape
              date={calendarData.date}
              timezone={calendarData.timezone}
              meetings={calendarData.meetings}
              focusLabels={uncompleted.map((p) => p.label ?? p.arc?.name ?? p.task?.title ?? p.session?.title ?? t('task'))}
              nowMs={nowMs}
              meetingMinutes={today?.meeting_minutes ?? 0}
              dueTasksCount={today?.due_tasks_count ?? 0}
            />
          )}

          {picks.length === 0 ? (
            <p className="px-1 py-2 text-sm text-text-sub">
              Nothing picked for today yet — add a focus, {t('task')}, or a quick note above.
            </p>
          ) : lens === 'list' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="today-list">
              {picks.map((pick) => (
                <TodayPickCard
                  key={pick.id}
                  pick={pick}
                  hasAttentionDot={!!pick.arc_id && !!legacyAttentionArcIds?.has(pick.arc_id)}
                />
              ))}
            </div>
          ) : (
            <TodayBoard picks={picks} legacyAttentionArcIds={legacyAttentionArcIds} />
          )}

          <DueSoonRow />
        </>
      )}
    </section>
  );
}
