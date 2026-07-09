'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useNow } from '@/lib/hooks/use-now';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { FleetTopbar } from '@/components/domain/oracle/FleetTopbar';
import { OracleToolbar } from '@/components/domain/oracle/OracleToolbar';
import { WaitingStrip } from '@/components/domain/oracle/WaitingStrip';
import { MachineSection } from '@/components/domain/oracle/MachineSection';
import {
  filterMachines,
  fleetCounts,
  selectWaitingSessions,
  anySessionRunning,
  anySessionNeedsAttention,
} from '@/components/domain/oracle/oracle-logic';

export default function OraclePage() {
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading: authLoading, isPmOrAdmin } = useAuth();
  const { data, isLoading, isError } = useOracleFleet();
  const now = useNow(1000);
  const [filter, setFilter] = React.useState('');
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Oracle is PM/Admin only (fleet telemetry across every machine) — same redirect
  // pattern as billing/admin pages.
  React.useEffect(() => {
    if (!authLoading && user && !isPmOrAdmin) {
      router.replace('/');
    }
  }, [authLoading, user, isPmOrAdmin, router]);

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[25rem] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isPmOrAdmin) return null;

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
  const waitingSessions = selectWaitingSessions(machines, now);
  const { sessions: sessionCount, agents: agentCount } = fleetCounts(machines);
  const isEmpty = sessionCount === 0;

  return (
    <div className="flex flex-col gap-3">
      <FleetTopbar
        sessionCount={sessionCount}
        agentCount={agentCount}
        machineCount={machines.length}
        anyRunning={anySessionRunning(machines)}
        anyNeedsAttention={anySessionNeedsAttention(machines)}
        generatedAt={data.generated_at}
      />
      <OracleToolbar
        filter={filter}
        onFilterChange={setFilter}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />

      {isEmpty ? (
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
        <div className="flex flex-col gap-4">
          <WaitingStrip sessions={waitingSessions} nowMs={now} collapsed={collapsed} />
          {machines.map((machine) => (
            <MachineSection key={machine.id} machine={machine} nowMs={now} collapsedCards={collapsed} />
          ))}
        </div>
      )}
    </div>
  );
}
