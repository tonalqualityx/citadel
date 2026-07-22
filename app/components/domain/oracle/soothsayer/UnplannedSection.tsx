'use client';

import { Select } from '@/components/ui/select';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useCreateTodayPick } from '@/lib/hooks/use-today';
import { capColumnCards } from '@/lib/kanban-caps';
import { SnoozeMenu } from './SnoozeMenu';
import { dayColumnLabel } from './soothsayer-logic';
import type { SoothsayerArc, SoothsayerSession } from '@/lib/hooks/use-soothsayer';

interface UnplannedSectionProps {
  arcs: SoothsayerArc[];
  sessions: SoothsayerSession[];
  /** The 7 day-column date strings, for the assign-to-day quick action. */
  dayDates: string[];
  todayDateStr: string;
}

// Clarity Phase 5 — "No day assigned": every OPEN, un-snoozed arc with no pick
// today-or-future, and every LIVE session (fleet: not ended/stale) with no pick — the
// can-never-lose-an-arc guarantee. Each row gets a quick "assign to day" day-picker
// (POST /api/today for that date, respecting the per-day WIP cap — its 409 surfaces via the
// existing useCreateTodayPick hook's error toast, no new error-handling path needed) and,
// for arcs, the same snooze action every arc card gets.
export function UnplannedSection({ arcs, sessions, dayDates, todayDateStr }: UnplannedSectionProps) {
  const { t } = useTerminology();
  const createPick = useCreateTodayPick();
  const dayOptions = dayDates.map((d) => ({ value: d, label: dayColumnLabel(d, todayDateStr) }));

  if (arcs.length === 0 && sessions.length === 0) return null;

  // Evidence-bound kanban density cap (binding across the whole Oracle face, unchanged
  // since Phase 3): 5-7 visible cards, overflow behind a static "+N more" — this section is
  // exactly the kind of list that can otherwise dump a dev machine's entire ambient session
  // count on screen at once (every idle Claude Code session with no pick ever assigned
  // qualifies as "unplanned" by definition), which is precisely the density problem the cap
  // exists to prevent.
  const cappedArcs = capColumnCards(arcs);
  const cappedSessions = capColumnCards(sessions);

  return (
    <section className="flex flex-col gap-2" data-testid="soothsayer-unplanned-section">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">No day assigned</h2>
      <div className="flex flex-col gap-2">
        {cappedArcs.visible.map((arc) => (
          <div
            key={arc.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-warm bg-surface p-2.5"
            data-testid="unplanned-arc-row"
            data-arc-id={arc.id}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-main">{arc.name}</div>
              <div className="truncate text-xs text-text-sub">
                arc · {arc.task_count} {arc.task_count === 1 ? t('task') : t('tasks')} · {arc.progress_percent}%
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Select
                options={dayOptions}
                value=""
                placeholder="Assign to day…"
                onChange={(date) => createPick.mutate({ date, item_type: 'arc', arc_id: arc.id })}
                className="w-40"
                aria-label={`Assign ${arc.name} to a day`}
              />
              <SnoozeMenu arcId={arc.id} snoozedUntil={arc.snoozed_until} />
            </div>
          </div>
        ))}
        {cappedArcs.overflowCount > 0 && (
          <div className="px-1 text-center text-xs text-text-sub">+ {cappedArcs.overflowCount} more arcs</div>
        )}

        {cappedSessions.visible.map((session) => (
          <div
            key={session.external_id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-warm bg-surface p-2.5"
            data-testid="unplanned-session-row"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-main">
                {session.title ?? session.external_id}
              </div>
              <div className="truncate text-xs text-text-sub">session · {session.status}</div>
            </div>
            <Select
              options={dayOptions}
              value=""
              placeholder="Assign to day…"
              onChange={(date) =>
                createPick.mutate({ date, item_type: 'session', session_external_id: session.external_id })
              }
              className="w-40 shrink-0"
              aria-label={`Assign ${session.title ?? session.external_id} to a day`}
            />
          </div>
        ))}
        {cappedSessions.overflowCount > 0 && (
          <div className="px-1 text-center text-xs text-text-sub">+ {cappedSessions.overflowCount} more sessions</div>
        )}
      </div>
    </section>
  );
}
