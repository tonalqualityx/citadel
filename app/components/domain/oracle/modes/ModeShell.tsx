'use client';

import * as React from 'react';
import type { OracleMachineDTO, OracleSessionWithMachine } from '@/lib/types/oracle';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { DEFAULT_MODE, type OracleMode } from './mode-shell-logic';
import { ModeTabs, ReturnToWork } from './ModeTabs';
import { WorkView } from './WorkView';
import { PlanView } from './PlanView';
import { ProcessView } from './ProcessView';

interface ModeShellProps {
  machines: OracleMachineDTO[];
  liveSessions: OracleSessionWithMachine[];
  legacyAttentionArcIds: Set<string>;
  nowMs: number;
}

// Clarity Phase 8 (composition) — the three-mode shell. Mode state is plain useState,
// NOT persisted (not localStorage, not UserPreference, not a URL param) — the mode-escort
// law says Work is the only self-serve surface and the day starts in Work; a persisted
// mode would land Mike in Plan or Process tomorrow morning, which is exactly backwards.
// The only three things that ever change the mode: a tab click, a door click, and
// "Return to Work" — no effect anywhere watches counts/timers and auto-switches.
export function ModeShell({ machines, liveSessions, legacyAttentionArcIds, nowMs }: ModeShellProps) {
  const [mode, setMode] = React.useState<OracleMode>(DEFAULT_MODE);
  // Shared query cache with page.tsx's own useWaitingOnMe() call (same query key) — React
  // Query dedupes this to one network request regardless of how many consumers subscribe.
  const { data: waitingOnMeData } = useWaitingOnMe();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-border-warm pb-2">
        <ModeTabs mode={mode} onChange={setMode} />
        <ReturnToWork mode={mode} onClick={() => setMode('work')} />
      </div>

      {mode === 'work' && (
        <WorkView
          machines={machines}
          liveSessions={liveSessions}
          waitingOnMe={waitingOnMeData}
          nowMs={nowMs}
          onGoToMode={setMode}
        />
      )}
      {mode === 'plan' && (
        <PlanView liveSessions={liveSessions} legacyAttentionArcIds={legacyAttentionArcIds} nowMs={nowMs} />
      )}
      {mode === 'process' && <ProcessView nowMs={nowMs} />}
    </div>
  );
}
