'use client';

import * as React from 'react';
import { useTodayPicks, useTodayCalendar, useDueSoonTasks } from '@/lib/hooks/use-today';
import { usePipelineAccords } from '@/lib/hooks/use-accords';
import { useTriageStats } from '@/lib/hooks/use-triage-stats';
import { selectWaitingSessions } from '@/components/domain/oracle/oracle-logic';
import { promisedDueTodayTasks as selectPromisedDueTodayTasks } from '@/lib/reason-chips';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import type { WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import type { OracleMode } from './mode-shell-logic';
import { SignalsRail } from './work/SignalsRail';
import { ClockStrip } from './work/ClockStrip';
import { TodaysPicksHero } from './work/TodaysPicksHero';
import { DoorsRow } from './work/DoorsRow';
import { buildDoors } from './work/doors-logic';

interface WorkViewProps {
  machines: OracleMachineDTO[];
  liveSessions: OracleSessionWithMachine[];
  waitingOnMe: WaitingOnMeResponse | undefined;
  nowMs: number;
  onGoToMode: (mode: OracleMode) => void;
}

// Clarity Phase 8 (composition) — Work mode: the ONLY self-serve surface (mode-escort
// law). Signals rail -> meetings-only clock strip -> Today's picks hero -> four
// information-scent doors. NOTHING else renders here — everything else is a drill-in via
// a door or a tab, never auto-surfaced.
export function WorkView({ machines, liveSessions, waitingOnMe, nowMs, onGoToMode }: WorkViewProps) {
  const { data: todayData } = useTodayPicks();
  const { data: calendarData } = useTodayCalendar();
  const { data: dueSoonData } = useDueSoonTasks();
  const { data: pipelineData } = usePipelineAccords();
  const { data: triageStats } = useTriageStats();

  const picks = React.useMemo(() => todayData?.picks ?? [], [todayData]);
  const timezone = calendarData?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;
  const todayDateStr = calendarData?.date ?? '';

  const crisisCount = waitingOnMe?.crisis.length ?? 0;
  // Clarity Phase 8 (shakedown round 2) — the signals rail's "N sessions need you" chip
  // expands into this exact list (title, waiting_on/ask, remote_url) so the chip's count
  // and its expanded contents can never disagree.
  const sessionsNeedingYou = React.useMemo(() => selectWaitingSessions(machines, nowMs), [machines, nowMs]);

  // Union of due-soon tasks + today-picked tasks with a due date, deduped by task id — the
  // signals rail and the Due-soon door read the same union so they can never disagree.
  const dueSoonTasks = React.useMemo(() => {
    const byId = new Map<
      string,
      { id: string; title: string; promised_to: string | null; due_date: string | null }
    >();
    for (const t of dueSoonData?.tasks ?? []) {
      byId.set(t.id, { id: t.id, title: t.title, promised_to: t.promised_to, due_date: t.due_date });
    }
    for (const p of picks) {
      if (p.task && p.task.due_date) {
        byId.set(p.task.id, {
          id: p.task.id,
          title: p.task.title,
          promised_to: p.task.promised_to,
          due_date: p.task.due_date,
        });
      }
    }
    return Array.from(byId.values());
  }, [dueSoonData, picks]);

  // Clarity Phase 8 (shakedown round 2) — the signals rail's "N promised tasks due today"
  // chip expands into this exact list. promisedDueTodayTasks's filter guarantees due_date is
  // set on every element it returns; the cast documents that invariant for the narrower
  // (non-nullable) prop type the expand panel wants.
  const promisedDueTodayTasksList = React.useMemo(
    () =>
      selectPromisedDueTodayTasks(dueSoonTasks, todayDateStr).map((t) => ({
        ...t,
        due_date: t.due_date as string,
      })),
    [dueSoonTasks, todayDateStr]
  );

  const reviewOldest = (waitingOnMe?.review ?? [])
    .map((r) => r.waiting_since)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;

  const intakeOldest = (waitingOnMe?.intake.items ?? [])
    .map((i) => i.received_at)
    .sort()[0] ?? null;

  const pipelineGroups = pipelineData?.groups;
  const pipelineOpenCount = (pipelineGroups?.prospect.length ?? 0) + (pipelineGroups?.in_motion.length ?? 0);
  const pipelineNothingMovingCount = [
    ...(pipelineGroups?.prospect ?? []),
    ...(pipelineGroups?.in_motion ?? []),
  ].filter((r) => !r.open_arc).length;

  const doors = buildDoors({
    reviewCount: waitingOnMe?.review.length ?? 0,
    reviewOldestWaitAt: reviewOldest,
    intakeCount: waitingOnMe?.intake.count ?? 0,
    intakeOldestAt: intakeOldest,
    archivedToday: triageStats?.archived_count ?? 0,
    pipelineOpenCount,
    pipelineNothingMovingCount,
    dueSoonTasks,
    nowMs,
  });

  const todayLabel = todayDateStr
    ? `Today · ${new Date(`${todayDateStr}T00:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    : 'Today';

  return (
    <div className="flex flex-col gap-5" data-testid="work-view">
      <SignalsRail
        crisisCount={crisisCount}
        promisedDueTodayTasks={promisedDueTodayTasksList}
        sessionsNeedingYou={sessionsNeedingYou}
        machines={machines}
        todayDateStr={todayDateStr}
        onGoToMode={onGoToMode}
      />
      <ClockStrip todayLabel={todayLabel} meetings={calendarData?.meetings ?? []} timezone={timezone} />
      <TodaysPicksHero picks={picks} sessions={liveSessions} todayDateStr={todayDateStr} />
      <DoorsRow doors={doors} onGoToMode={onGoToMode} />
    </div>
  );
}
