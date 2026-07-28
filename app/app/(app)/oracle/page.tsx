'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useNow } from '@/lib/hooks/use-now';
import { Spinner } from '@/components/ui/spinner';
import { OracleHeader } from '@/components/domain/oracle/OracleHeader';
import { CrisisStrip } from '@/components/domain/oracle/crisis/CrisisStrip';
import { RitualGate } from '@/components/domain/oracle/RitualGate';
import { hasCrisis } from '@/components/domain/oracle/crisis/crisis-strip-logic';
import { ModeShell } from '@/components/domain/oracle/modes/ModeShell';
import { TaskPeekProvider } from '@/lib/contexts/task-peek-context';
import { FocusModeProvider } from '@/lib/contexts/focus-mode-context';
import {
  groupNonWaitingSessions,
  legacyNeedsAttentionArcIds,
  flattenSessions,
} from '@/components/domain/oracle/oracle-logic';

// Clarity Phase 8 (composition) — the three-mode rebuild (Work/Plan/Process; see
// components/domain/oracle/modes/ModeShell.tsx and the mode-escort law in
// mode-shell-logic.ts). This page now only ever mounts: the slimmed header, the crisis
// strip (a SIBLING of the ritual gate — must render through the cover, always), the
// ritual gate, and the mode shell — every other surface Phase 1-7 built (Today, Needs
// Reshi, Pipeline, the week strip, the cron health line) now lives INSIDE one of the three
// modes, reused as-is (see WorkView/PlanView/ProcessView).
//
// Clarity Phase 3c — Fleet screen split (unchanged): the Seeing Stone is the ATTENTION
// surface only; In Motion/Docked live on their own screen, /oracle/fleet.
//
// Clarity Phase 5 — legacy hook-flagged needs_attention sessions with no manifest ask
// still never render as their own cards here (Mike's ruling stands): linked-to-an-arc ones
// become a quiet attention dot on the arc's Today pick card (Plan mode); unlinked ones
// live on the Fleet screen.
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
  // Plan mode's attention-dot lookup (see TodaySection's legacyAttentionArcIds prop).
  const legacyAttentionArcIds = legacyNeedsAttentionArcIds(data.machines, now);
  const liveSessions = flattenSessions(data.machines);

  return (
    // Clarity Phase 4b — every quest/task-opening action inside this tree (Review queue
    // cards, Today pick cards, the due-soon row, intake drawer's Create + open) opens the
    // shared peek drawer this provider owns, instead of navigating away from /oracle.
    <TaskPeekProvider>
      {/* Clarity Phase 7 (P2) — Focus Mode (spec Q8), entered from any Today/hero card. */}
      <FocusModeProvider>
        <div className="flex flex-col gap-4">
          <OracleHeader
            fleetCounts={{ inMotion: groups.working.length, docked: groups.idle.length }}
            intake={waitingOnMeData?.intake}
          />

          {waitingOnMeData && <CrisisStrip crisis={waitingOnMeData.crisis} />}

          {/* Clarity Phase 7 (P2) — the ritual gate (spec Q7). CrisisStrip above stays a
              sibling, never a child, of the gate — it must render THROUGH the cover,
              always. */}
          <RitualGate hasCrisis={hasCrisis(waitingOnMeData?.crisis ?? [])}>
            <ModeShell
              machines={data.machines}
              liveSessions={liveSessions}
              legacyAttentionArcIds={legacyAttentionArcIds}
              nowMs={now}
            />
          </RitualGate>
        </div>
      </FocusModeProvider>
    </TaskPeekProvider>
  );
}
