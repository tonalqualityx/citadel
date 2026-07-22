'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useNow } from '@/lib/hooks/use-now';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { OracleToolbar } from '@/components/domain/oracle/OracleToolbar';
import { InMotion } from '@/components/domain/oracle/InMotion';
import { Docked } from '@/components/domain/oracle/Docked';
import { WaitingStrip } from '@/components/domain/oracle/WaitingStrip';
import { CronHealthLine } from '@/components/domain/oracle/CronHealthLine';
import {
  filterMachines,
  groupNonWaitingSessions,
  unlinkedLegacyWaitingSessions,
} from '@/components/domain/oracle/oracle-logic';

// Clarity Phase 3c — Fleet screen. Split off the Seeing Stone (/oracle), which is now
// the attention surface only. This screen carries exactly the machinery half of the
// old Oracle page: the toolbar (filter/collapse-all/New session, all coupled to these
// two sections), In Motion (the working bucket), and Docked (the idle bucket) —
// reused verbatim, unchanged behavior. The machine-health/cron-error line is
// duplicated here (also on Seeing Stone's header, via the shared CronHealthLine
// component) per Mike's ruling: an admin landing directly on Fleet shouldn't have to
// bounce back to Seeing Stone just to see a cron is erroring.
export default function OracleFleetPage() {
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading: authLoading, isAdmin } = useAuth();
  const { data, isLoading, isError } = useOracleFleet();
  const now = useNow(1000);
  const [filter, setFilter] = React.useState('');
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Same admin-only gate as Seeing Stone (Phase 1.5a ruling) — unaffected by the split.
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
  // Clarity Phase 5 — legacy hook-flagged needs_attention sessions with NO arc link move
  // here entirely (removed from Needs Reshi on the Seeing Stone) via the existing,
  // previously-unused WaitingStrip component. Linked ones render as a dot on their arc's
  // Today/Soothsayer card instead — they never show up here.
  const waitingSessions = unlinkedLegacyWaitingSessions(machines, now);

  const noMachineHasEverReported = data.machines.length === 0;
  const anyCommands = machines.some((m) => m.commands.length > 0);
  const isEmpty =
    dockedSessions.length === 0 && inMotionSessions.length === 0 && waitingSessions.length === 0 && !anyCommands;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1" data-testid="fleet-header">
        <h1 className="text-lg font-bold text-text-main">Fleet</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-sub">
          <CronHealthLine machines={data.machines} bullet={false} />
        </div>
      </header>

      <OracleToolbar
        filter={filter}
        onFilterChange={setFilter}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        machines={data.machines}
      />

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
          <WaitingStrip sessions={waitingSessions} nowMs={now} collapsed={collapsed} />
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
