'use client';

import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { SessionCard } from './SessionCard';

interface DockedProps {
  sessions: OracleSessionWithMachine[];
  nowMs: number;
  collapsed: boolean;
}

// "Docked": threads waiting on the world — the existing waiting-on-Reshi bucket
// (isWaitingSession), renamed/restyled per the new grammar but functionally unchanged: it
// is never auto-hidden while its arc is open (that's a server-side archived_at concern,
// already handled — see /api/oracle/fleet's archived filter). Reuses SessionCard verbatim
// for the same reason as InMotion: Respond/nesting/drawer stay fully intact.
export function Docked({ sessions, nowMs, collapsed }: DockedProps) {
  if (sessions.length === 0) return null;

  return (
    <section aria-label="Docked" data-testid="docked-section" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
        Docked <span className="font-normal">({sessions.length} threads waiting on the world)</span>
      </h2>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            nowMs={nowMs}
            collapsed={collapsed}
            className="border-[color:var(--warning)]"
          />
        ))}
      </div>
    </section>
  );
}
