'use client';

import * as React from 'react';
import { Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRitualRunStatus, useBailRitual } from '@/lib/hooks/use-ritual-runs';
import { useTodayPicks } from '@/lib/hooks/use-today';
import { isRitualSatisfied, isNoOpDay, ritualGateCopy } from '@/lib/ritual-runs';

interface RitualGateProps {
  children: React.ReactNode;
  // Whether the crisis lane currently has anything open — CrisisStrip itself always
  // renders OUTSIDE this component (see oracle/page.tsx), this is only consulted to decide
  // whether today reads as a genuine no-op day for the cover's softened copy.
  hasCrisis: boolean;
}

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the ritual gate (spec Q7). A hard cover over
// Today/Needs Reshi until the morning ritual has run OR Mike explicitly bails — never a
// passive/guilt-toned nag, never a "ritual is done" button (the ritual session itself POSTs
// ran, machine-side; offering a manual "done" button here would just be a second, easier-to-
// fake path to the same state). The crisis lane is never inside this component — CrisisStrip
// renders as this component's SIBLING in oracle/page.tsx, above the cover, always visible.
export function RitualGate({ children, hasCrisis }: RitualGateProps) {
  const { data: ritualStatus, isLoading: ritualLoading } = useRitualRunStatus();
  const { data: todayData, isLoading: picksLoading } = useTodayPicks();
  const bail = useBailRitual();

  if (ritualLoading || picksLoading) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  const satisfied = isRitualSatisfied(ritualStatus ?? null);
  if (satisfied) {
    return <>{children}</>;
  }

  const pickCount = todayData?.picks?.length ?? 0;
  const noOpDay = isNoOpDay(pickCount, hasCrisis);

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-border-warm bg-surface px-6 py-10 text-center"
      data-testid="ritual-gate-cover"
    >
      <Moon className="h-6 w-6 text-text-sub" aria-hidden="true" />
      <p className="max-w-sm text-sm text-text-sub" data-testid="ritual-gate-copy">
        {ritualGateCopy(noOpDay)}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => bail.mutate('morning')}
        disabled={bail.isPending}
        data-testid="ritual-gate-bail"
        className="text-text-sub"
      >
        Bail for today
      </Button>
    </div>
  );
}
