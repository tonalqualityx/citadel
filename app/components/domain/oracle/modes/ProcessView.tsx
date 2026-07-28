'use client';

import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useAdminSoonTasks } from '@/lib/hooks/use-admin-soon';
import { useTriageStats } from '@/lib/hooks/use-triage-stats';
import { groupReviewByClient } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';
import { ProcessDealer } from './process/ProcessDealer';

interface ProcessViewProps {
  nowMs: number;
}

// Clarity Phase 8 (composition) — Process mode: the weekly ~45-60 min batch (DAY-REALITY
// #4). Banner sets expectations; the triage chip (spec: "Process/intake area + Work door
// subtext") lives right here too; everything else is the one-card-at-a-time dealer.
export function ProcessView({ nowMs }: ProcessViewProps) {
  const { data: waitingOnMeData } = useWaitingOnMe();
  const { data: adminSoonData } = useAdminSoonTasks();
  const { data: triageStats } = useTriageStats();

  const reviewGroups = groupReviewByClient(waitingOnMeData?.review ?? []);
  const intakeAsks = (waitingOnMeData?.intake.items ?? []).filter((a) => a.state === 'open');

  return (
    <div className="flex flex-col gap-4" data-testid="process-view">
      <div className="flex items-start gap-2 rounded-lg border border-border-warm bg-surface px-4 py-3 text-sm text-text-sub">
        <span className="text-[color:var(--accent)]" aria-hidden="true">⚙</span>
        <span>
          The weekly batch — about 45-60 minutes. Everything below is pre-chewed: decisions and
          signatures, not archaeology.
          {!!triageStats && triageStats.archived_count > 0 && (
            <span data-testid="process-triage-chip"> · {triageStats.archived_count} auto-archived today</span>
          )}
        </span>
      </div>

      <ProcessDealer
        intakeAsks={intakeAsks}
        reviewGroups={reviewGroups}
        adminTasks={adminSoonData?.tasks ?? []}
        nowMs={nowMs}
      />
    </div>
  );
}
