'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useNow } from '@/lib/hooks/use-now';
import { Spinner } from '@/components/ui/spinner';
import { OracleHeader } from '@/components/domain/oracle/OracleHeader';
import { TodaySection } from '@/components/domain/oracle/today/TodaySection';
import { NeedsReshi } from '@/components/domain/oracle/needs-reshi/NeedsReshi';
import { CrisisStrip } from '@/components/domain/oracle/crisis/CrisisStrip';
import { TaskPeekProvider } from '@/lib/contexts/task-peek-context';
import {
  groupNonWaitingSessions,
  legacyNeedsAttentionArcIds,
  flattenSessions,
} from '@/components/domain/oracle/oracle-logic';

// Clarity Phase 3c — Fleet screen split. Mike's ruling: the Seeing Stone (/oracle) is
// the ATTENTION surface only — header (idea quick-add, week strip, cron health) ->
// Today -> Needs Reshi (merged "Waiting on you" + grouped Review). In Motion and Docked
// (the fleet machinery) moved to their own screen, /oracle/fleet (see
// app/(app)/oracle/fleet/page.tsx) — reached via the header's quiet "N in motion · M
// docked" link.
//
// Clarity Phase 5 — legacy hook-flagged needs_attention sessions with no manifest ask no
// longer render as cards here at all (Mike's ruling: "legacy flag-only cards REMOVED from
// the glass"). Linked-to-an-arc ones become a quiet attention dot on the arc's own Today
// pick card (legacyNeedsAttentionArcIds below); unlinked ones moved entirely to the Fleet
// screen (see app/(app)/oracle/fleet/page.tsx's WaitingStrip).
export default function OraclePage() {
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading: authLoading, isAdmin } = useAuth();
  const { data, isLoading, isError } = useOracleFleet();
  const { data: waitingOnMeData } = useWaitingOnMe();
  const now = useNow(1000);

  React.useEffect(() => setMounted(true), []);

  // Oracle is admin-only (fleet telemetry across every machine, plus Remote Spawn, Today,
  // and Needs Reshi) — preserved intact from Phase 1.5a's tightened ruling.
  React.useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [authLoading, user, isAdmin, router]);

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[25rem] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex min-h-[25rem] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-12 text-center text-sm text-text-sub">Failed to load fleet telemetry.</div>
    );
  }

  // Unfiltered, fleet-wide bucket counts feed the header's "N in motion · M docked"
  // link — Fleet owns its own (filterable) view of these same buckets, this page only
  // ever needs the totals.
  const groups = groupNonWaitingSessions(data.machines);
  // Clarity Phase 5 — the arc ids carrying a linked legacy needs-attention session, for
  // Today's attention-dot lookup (see TodaySection's legacyAttentionArcIds prop).
  const legacyAttentionArcIds = legacyNeedsAttentionArcIds(data.machines, now);
  const liveSessions = flattenSessions(data.machines);

  return (
    // Clarity Phase 4b — every quest/task-opening action inside this tree (Review queue
    // cards, Today pick cards, the due-soon row, intake drawer's Create + open) opens the
    // shared peek drawer this provider owns, instead of navigating away from /oracle.
    <TaskPeekProvider>
      <div className="flex flex-col gap-4">
        <OracleHeader
          machines={data.machines}
          fleetCounts={{ inMotion: groups.working.length, docked: groups.idle.length }}
          intake={waitingOnMeData?.intake}
        />

        {waitingOnMeData && <CrisisStrip crisis={waitingOnMeData.crisis} />}

        <TodaySection legacyAttentionArcIds={legacyAttentionArcIds} />

        {waitingOnMeData && (
          <NeedsReshi data={waitingOnMeData} liveSessions={liveSessions} nowMs={now} />
        )}
      </div>
    </TaskPeekProvider>
  );
}
