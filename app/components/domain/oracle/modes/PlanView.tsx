'use client';

import { useTodayCalendar } from '@/lib/hooks/use-today';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { WeekStrip } from '@/components/domain/oracle/today/WeekStrip';
import { TodaySection } from '@/components/domain/oracle/today/TodaySection';
import { NeedsReshi } from '@/components/domain/oracle/needs-reshi/NeedsReshi';
import { PipelineLane } from '@/components/domain/oracle/PipelineLane';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';

interface PlanViewProps {
  liveSessions: OracleSessionWithMachine[];
  legacyAttentionArcIds: Set<string>;
  nowMs: number;
}

// Clarity Phase 8 (composition) — Plan mode: the ritual's room. Full breadth is allowed
// here (mode-escort law: Plan is walked WITH Bast / entered via a door, never the default).
// Reuses existing Phase 1-7 components as-is: week strip, TodaySection's doing-first/
// done-collapsed board, NeedsReshi's two-column ledger, PipelineLane.
export function PlanView({ liveSessions, legacyAttentionArcIds, nowMs }: PlanViewProps) {
  const { data: calendarData } = useTodayCalendar();
  const { data: waitingOnMeData } = useWaitingOnMe();

  return (
    <div className="flex flex-col gap-5" data-testid="plan-view">
      {calendarData && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-text-sub">Week</span>
          <WeekStrip week={calendarData.week} todayDate={calendarData.date} />
        </div>
      )}

      <TodaySection legacyAttentionArcIds={legacyAttentionArcIds} />

      {waitingOnMeData && <NeedsReshi data={waitingOnMeData} liveSessions={liveSessions} nowMs={nowMs} />}

      <PipelineLane />
    </div>
  );
}
