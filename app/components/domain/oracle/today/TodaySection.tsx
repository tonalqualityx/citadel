'use client';

import * as React from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useNow } from '@/lib/hooks/use-now';
import { useTodayPicks, useTodayCalendar } from '@/lib/hooks/use-today';
import { usePreferences, useUpdatePreferences } from '@/lib/hooks/use-preferences';
import { TODAY_PICK_WIP_CAP, isPastWarningThreshold } from '@/lib/today-picks';
import { Spinner } from '@/components/ui/spinner';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { excludeLinkedPicks, linkedMeetingIds } from './time-shape-logic';
import { ENERGY_FILTER_OPTIONS, filterPicksByEnergy, type EnergyFilterValue } from './energy-filter-logic';
import { TimeShape } from './TimeShape';
import { NowStrip } from './NowStrip';
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
  // Clarity Phase 7 (P2) — the list/board lens toggle, persisted cross-device via
  // UserPreference (spec Q10). `localLens` is a same-session optimistic override so the
  // toggle feels instant; before any click this render, the server's own today_view wins
  // (never a client-only choice) — after a click, both agree once the PATCH settles.
  const { data: preferencesData } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const [localLens, setLocalLens] = React.useState<'list' | 'board' | null>(null);
  const lens = localLens ?? preferencesData?.preferences.today_view ?? 'list';

  function setLens(next: 'list' | 'board') {
    setLocalLens(next);
    updatePreferences.mutate({ today_view: next });
  }

  // Clarity Phase 3 (Reckoning, spec Q9/G10) — the energy filter chips: a VIEW filter
  // only, persisted the same optimistic-then-server way as the list/board lens above —
  // never a reorder of the stored picks themselves.
  const [localEnergyFilter, setLocalEnergyFilter] = React.useState<EnergyFilterValue | null>(null);
  const energyFilter = localEnergyFilter ?? preferencesData?.preferences.energy_filter ?? 'all';

  function setEnergyFilter(next: EnergyFilterValue) {
    setLocalEnergyFilter(next);
    updatePreferences.mutate({ energy_filter: next });
  }

  const isLoading = picksLoading || calendarLoading;

  const picks = todayData?.picks ?? [];
  const uncompleted = picks.filter((p) => !p.completed_at);
  const doneToday = picks.length - uncompleted.length;
  const overWarning = isPastWarningThreshold(uncompleted.length);

  const earliestPickedAt = picks.length
    ? picks.reduce((min, p) => (p.created_at < min ? p.created_at : min), picks[0].created_at)
    : null;

  // Clarity Phase 3 (Reckoning, spec Q9/G10) — the energy filter applies to the
  // rendered list/board grid only. Now Strip (the already-committed 1-3 leading picks)
  // and the header's WIP/done counters stay UNFILTERED — those are honest counts of
  // what's actually picked, never something a view filter should make look smaller.
  const visiblePicks = filterPicksByEnergy(picks, energyFilter);

  const today = calendarData?.week?.[0];
  // Falls back to the client-safe default while calendarData is still loading —
  // reconciles with the resolved zone the instant the response arrives.
  const timezone = calendarData?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;

  return (
    <section className="flex flex-col gap-3" data-testid="today-section">
      {!isLoading && (
        <NowStrip
          picks={uncompleted}
          todayDateStr={calendarData?.date ?? today?.date ?? ''}
          legacyAttentionArcIds={legacyAttentionArcIds}
        />
      )}

      {/* Clarity Phase 7 (P2) — the Now Strip leads; everything below reads visually
          secondary (research law: execution view leads, planning view stays present but
          demoted — never hidden). */}
      <div className="flex flex-col gap-2 opacity-90">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="text-xs font-bold uppercase tracking-wide text-text-sub">Today</h2>
        <span
          className={cn(
            'ml-auto text-xs',
            overWarning ? 'font-semibold text-[var(--warning)]' : 'text-text-sub'
          )}
        >
          <b className="text-text-main" data-testid="today-wip-count">{uncompleted.length}</b> of {TODAY_PICK_WIP_CAP} threads
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

      {/* Clarity Phase 3 (Reckoning, spec Q9/G10) — energy filter chips: a view filter
          only, never a reorder of the stored picks. */}
      <div className="flex flex-wrap items-center gap-1 px-1" data-testid="energy-filter-chips">
        {ENERGY_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setEnergyFilter(option.value)}
            aria-pressed={energyFilter === option.value}
            data-testid={`energy-filter-${option.value}`}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              energyFilter === option.value
                ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-text-main'
                : 'border-border-warm text-text-sub hover:text-text-main'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size="md" />
        </div>
      ) : (
        <>
          {calendarData && (() => {
            // Clarity Phase 7 (P2, spec G3) — timeline dedup: a pick linked to a rendered
            // meeting (calendar_event_id matches) is the SAME commitment that meeting
            // block already renders — it contributes no separate focus block, and that
            // meeting's own chip renders "styled as linked" instead (see TimeShape).
            const dedupablePicks = uncompleted.map((p) => ({
              label: p.label ?? p.arc?.name ?? p.task?.title ?? p.session?.title ?? t('task'),
              calendar_event_id: p.calendar_event_id,
            }));
            const focusLabels = excludeLinkedPicks(dedupablePicks, calendarData.meetings).map((p) => p.label);
            const linkedIds = linkedMeetingIds(dedupablePicks);

            return (
              <TimeShape
                date={calendarData.date}
                timezone={calendarData.timezone}
                meetings={calendarData.meetings}
                focusLabels={focusLabels}
                linkedMeetingIds={linkedIds}
                nowMs={nowMs}
                meetingMinutes={today?.meeting_minutes ?? 0}
                dueTasksCount={today?.due_tasks_count ?? 0}
              />
            );
          })()}

          {picks.length === 0 ? (
            <p className="px-1 py-2 text-sm text-text-sub">
              Nothing picked for today yet — add a focus, {t('task')}, or a quick note above.
            </p>
          ) : visiblePicks.length === 0 ? (
            <p className="px-1 py-2 text-sm text-text-sub" data-testid="energy-filter-empty">
              Nothing matches this filter — try All.
            </p>
          ) : lens === 'list' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="today-list">
              {visiblePicks.map((pick) => (
                <TodayPickCard
                  key={pick.id}
                  pick={pick}
                  hasAttentionDot={!!pick.arc_id && !!legacyAttentionArcIds?.has(pick.arc_id)}
                />
              ))}
            </div>
          ) : (
            <TodayBoard picks={visiblePicks} legacyAttentionArcIds={legacyAttentionArcIds} />
          )}

          <DueSoonRow />
        </>
      )}
      </div>
    </section>
  );
}
