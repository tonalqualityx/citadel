'use client';

import { AlertTriangle } from 'lucide-react';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { SessionCard } from './SessionCard';

interface WaitingStripProps {
  sessions: OracleSessionWithMachine[];
  nowMs: number;
  collapsed: boolean;
}

// THE priority element, especially on mobile: sessions waiting on Reshi or flagged
// needs_attention, pinned above every other group, longest wait first (selection +
// sort live in oracle-logic.ts so it's unit-testable without rendering React).
export function WaitingStrip({ sessions, nowMs, collapsed }: WaitingStripProps) {
  if (sessions.length === 0) return null;

  return (
    <section aria-label="Waiting on Reshi" data-testid="waiting-strip" className="flex flex-col gap-2">
      <h2
        className="ui-monospace flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide"
        style={{ color: 'var(--warning)' }}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Waiting on Reshi ({sessions.length})
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
