'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useNow } from '@/lib/hooks/use-now';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { OracleHeader } from '@/components/domain/oracle/OracleHeader';
import { OracleToolbar } from '@/components/domain/oracle/OracleToolbar';
import { TodaySection } from '@/components/domain/oracle/today/TodaySection';
import { NeedsReshi } from '@/components/domain/oracle/needs-reshi/NeedsReshi';
import { InMotion } from '@/components/domain/oracle/InMotion';
import { Docked } from '@/components/domain/oracle/Docked';
import {
  filterMachines,
  groupNonWaitingSessions,
  legacyNeedsAttentionSessions,
  flattenSessions,
} from '@/components/domain/oracle/oracle-logic';

// Clarity Phase 3 — The Oracle Face. Reworked per the approved mockup grammar: Header (title
// + machine-health line + idea quick-add + week strip) -> Today (time-shape + picks) ->
// Needs Reshi (Decide/Answer/Review) -> In motion (working sessions ONLY) -> Docked (idle
// sessions — parked threads "waiting on the world"). Crons and ended/archived sessions
// render nothing per the exception-based display rule. A session flagged needs_attention by
// the OLD hook mechanism with no Phase-1 manifest ask (legacyNeedsAttentionSessions) is
// waiting on MIKE, not the world — it renders in Needs Reshi's Answer column, never here.
export default function OraclePage() {
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading: authLoading, isAdmin } = useAuth();
  const { data, isLoading, isError } = useOracleFleet();
  const { data: waitingOnMeData } = useWaitingOnMe();
  const now = useNow(1000);
  const [filter, setFilter] = React.useState('');
  const [collapsed, setCollapsed] = React.useState(false);

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

  const machines = filterMachines(data.machines, filter);
  const groups = groupNonWaitingSessions(machines);
  // In Motion = the WORKING bucket only (isWorkingBucketSession) — zero idle here.
  const inMotionSessions = groups.working;
  const inMotionAgentCount = inMotionSessions.reduce((sum, s) => sum + s.agents.length, 0);
  // Docked = the IDLE bucket — alive, not working, not waiting: parked threads waiting on
  // the world, not on Mike.
  const dockedSessions = groups.idle;
  // Legacy hook-flagged needs_attention sessions with no manifest ask — waiting on Mike,
  // rendered in Needs Reshi's Answer column (see NeedsReshi below), not in Docked.
  const legacyWaitingSessions = legacyNeedsAttentionSessions(machines, now);
  const liveSessions = flattenSessions(data.machines);

  const noMachineHasEverReported = data.machines.length === 0;
  const anyCommands = machines.some((m) => m.commands.length > 0);
  const isEmpty =
    dockedSessions.length === 0 &&
    inMotionSessions.length === 0 &&
    legacyWaitingSessions.length === 0 &&
    !anyCommands;

  return (
    <div className="flex flex-col gap-4">
      <OracleHeader machines={data.machines} />
      <OracleToolbar
        filter={filter}
        onFilterChange={setFilter}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        machines={data.machines}
      />

      <TodaySection />

      {waitingOnMeData && (
        <NeedsReshi
          data={waitingOnMeData}
          liveSessions={liveSessions}
          legacyWaitingSessions={legacyWaitingSessions}
        />
      )}

      {noMachineHasEverReported ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" />}
          title="no telemetry has ever reached this Citadel"
          description="Check the oracle heartbeat on the machine. Nothing has POSTed to Oracle ingest yet."
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" />}
          title="no agents running"
          description={
            filter
              ? 'No sessions or agents match that filter.'
              : 'Nothing on the fleet right now — Claude Code sessions, workflow runs, and crons will show up here as they start.'
          }
        />
      ) : (
        <>
          <InMotion
            sessions={inMotionSessions}
            agentCount={inMotionAgentCount}
            nowMs={now}
            collapsed={collapsed}
          />
          <Docked sessions={dockedSessions} nowMs={now} collapsed={collapsed} />
        </>
      )}
    </div>
  );
}
