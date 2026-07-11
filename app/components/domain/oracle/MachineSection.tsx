'use client';

import { AlertOctagon } from 'lucide-react';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { SessionCard } from './SessionCard';
import { CollapsibleGroup } from './CollapsibleGroup';
import { CommandStrip } from './CommandStrip';
import { groupNonWaitingSessions, formatElapsed, formatHeartbeatTime } from './oracle-logic';

interface MachineSectionProps {
  machine: OracleMachineDTO;
  nowMs: number;
  collapsedCards: boolean;
}

// Machine header strip (name + heartbeat freshness, or a stale banner) followed by
// this machine's non-waiting sessions: Working then Idle visible, Crons / Recently
// ended collapsed — the mobile stack order, reused as-is on desktop. (Waiting-on-
// Reshi is selected fleet-wide and pinned above every machine, one level up.)
export function MachineSection({ machine, nowMs, collapsedCards }: MachineSectionProps) {
  const groups = groupNonWaitingSessions([machine]);
  const totalNonWaiting =
    groups.working.length + groups.idle.length + groups.crons.length + groups.recentlyEnded.length;
  const hasCommands = machine.commands.length > 0;

  // A machine with a freshly-queued spawn command but no sessions yet (dispatcher
  // hasn't run within its ~1 minute cadence) should still surface here — otherwise
  // the pending chip is invisible until the spawned session's own hooks/heartbeat
  // land, which defeats the point of showing command status at all.
  if (totalNonWaiting === 0 && !hasCommands) return null;

  const heartbeatMs = machine.last_heartbeat_at
    ? nowMs - new Date(machine.last_heartbeat_at).getTime()
    : null;

  return (
    <section className="flex flex-col gap-3" data-testid="machine-section" data-machine={machine.name}>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-background-light/60 px-3 py-2">
        <span className="text-sm font-extrabold text-text-main">{machine.name}</span>
        {machine.hostname && (
          <span className="ui-monospace truncate text-xs text-text-sub">{machine.hostname}</span>
        )}
        <span className="ui-monospace ml-auto shrink-0 text-xs text-text-sub">
          {heartbeatMs != null ? `heartbeat ${formatElapsed(heartbeatMs)} ago` : 'no heartbeat yet'}
        </span>
      </div>

      <CommandStrip commands={machine.commands} nowMs={nowMs} />

      {machine.stale && (
        <div
          className="ui-monospace flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold"
          style={{
            borderColor: 'color-mix(in srgb, var(--text-muted) 45%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
            color: 'var(--text-muted)',
          }}
          role="status"
        >
          <AlertOctagon className="h-4 w-4 shrink-0" />
          telemetry stale since {formatHeartbeatTime(machine.last_heartbeat_at)}
        </div>
      )}

      {groups.working.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="ui-monospace px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
            Working ({groups.working.length})
          </h3>
          <div className="flex flex-col gap-2">
            {groups.working.map((session) => (
              <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsedCards} />
            ))}
          </div>
        </div>
      )}

      {groups.idle.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="ui-monospace px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
            Idle ({groups.idle.length})
          </h3>
          <div className="flex flex-col gap-2">
            {groups.idle.map((session) => (
              <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsedCards} />
            ))}
          </div>
        </div>
      )}

      <CollapsibleGroup title="Crons" count={groups.crons.length}>
        {groups.crons.map((session) => (
          <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsedCards} />
        ))}
      </CollapsibleGroup>

      <CollapsibleGroup title="Recently ended" count={groups.recentlyEnded.length}>
        {groups.recentlyEnded.map((session) => (
          <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsedCards} />
        ))}
      </CollapsibleGroup>
    </section>
  );
}
