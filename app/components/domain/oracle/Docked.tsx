'use client';

import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { SessionCard } from './SessionCard';

interface DockedProps {
  sessions: OracleSessionWithMachine[];
  nowMs: number;
  collapsed: boolean;
}

// "Docked": the IDLE bucket (isIdleSession — alive, not working, not waiting) — parked
// threads waiting on the WORLD, not on Mike. Corrected mapping: this used to be the
// waiting-on-Reshi bucket, but a session actually flagged needs_attention/waiting belongs
// in Needs Reshi's Answer column now (it's waiting on Mike specifically), never here. Idle
// is a calm, neutral state — no warning-colored border, no urgency styling — "neutral
// aging" per the evidence-bound rules: parked is not alarming. Never auto-hidden while its
// arc is open (a server-side archived_at concern, already handled — see
// /api/oracle/fleet's archived filter). Reuses SessionCard verbatim for the same reason as
// InMotion: Respond/resume, agent nesting, and the event drawer stay fully intact.
export function Docked({ sessions, nowMs, collapsed }: DockedProps) {
  if (sessions.length === 0) return null;

  return (
    <section aria-label="Docked" data-testid="docked-section" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
        Docked <span className="font-normal">({sessions.length} threads waiting on the world)</span>
      </h2>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsed} />
        ))}
      </div>
    </section>
  );
}
