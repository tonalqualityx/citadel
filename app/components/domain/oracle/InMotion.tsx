'use client';

import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { SessionCard } from './SessionCard';

interface InMotionProps {
  sessions: OracleSessionWithMachine[];
  agentCount: number;
  nowMs: number;
  collapsed: boolean;
}

// "In motion": the WORKING bucket ONLY (isWorkingBucketSession — actively computing right
// now, or an orchestrator with a live running child), flattened fleet-wide — no more
// per-machine grouping. Idle sessions do NOT belong here (Docked owns those — see
// oracle/page.tsx's corrected mapping). Deliberately reuses SessionCard verbatim rather
// than a bespoke slim row: it's the one component that already carries Respond deep-links,
// agent nesting, and the event drawer intact, and preserving that behavior is a harder
// requirement than matching the mockup's slimmer visual exactly (documented deviation).
export function InMotion({ sessions, agentCount, nowMs, collapsed }: InMotionProps) {
  if (sessions.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="in-motion-section">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
        In motion <span className="font-normal">({sessions.length} sessions · {agentCount} agents)</span>
      </h2>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} nowMs={nowMs} collapsed={collapsed} />
        ))}
      </div>
    </section>
  );
}
