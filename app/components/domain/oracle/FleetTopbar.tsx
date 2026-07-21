'use client';

import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils/cn';
import { StatusDot } from './StatusDot';
import { formatClock } from './oracle-logic';

interface FleetTopbarProps {
  sessionCount: number;
  agentCount: number;
  machineCount: number;
  anyRunning: boolean;
  anyNeedsAttention: boolean;
  generatedAt: string | null;
}

// Ringside topbar: status dot + headline + subtitle + "N sessions · M agents" +
// live clock. Live clock ticks client-side off useNow — it never triggers a refetch.
export function FleetTopbar({
  sessionCount,
  agentCount,
  machineCount,
  anyRunning,
  anyNeedsAttention,
  generatedAt,
}: FleetTopbarProps) {
  const now = useNow(1000);

  const topStatus = anyNeedsAttention ? 'needs_attention' : anyRunning ? 'running' : 'stale';

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-warm px-1 pb-3">
      <StatusDot status={topStatus} needsAttention={anyNeedsAttention} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-base font-bold uppercase tracking-tight text-text-main">
          Seeing Stone
        </h1>
        <span className="ui-monospace truncate text-xs text-text-sub">
          {machineCount === 0
            ? 'no machines reporting'
            : `${machineCount} ${machineCount === 1 ? 'machine' : 'machines'}`}
        </span>
        <span className="ui-monospace truncate text-xs text-text-main">
          {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} · {agentCount}{' '}
          {agentCount === 1 ? 'agent' : 'agents'}
        </span>
      </div>
      <div className={cn('ui-monospace shrink-0 text-xs text-text-sub')} suppressHydrationWarning>
        {formatClock(now)}
      </div>
      {generatedAt && (
        <span className="ui-monospace hidden shrink-0 text-[0.65rem] text-text-sub sm:inline">
          updated {formatClock(new Date(generatedAt).getTime())}
        </span>
      )}
    </div>
  );
}
