'use client';

import * as React from 'react';
import { Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { useRitualRunStatus, useBailRitual, useQuickStartRitual } from '@/lib/hooks/use-ritual-runs';
import { useTodayPicks } from '@/lib/hooks/use-today';
import { isRitualSatisfied, isNoOpDay, ritualGateCopy } from '@/lib/ritual-runs';

interface RitualGateProps {
  children: React.ReactNode;
  // Whether the crisis lane currently has anything open — CrisisStrip itself always
  // renders OUTSIDE this component (see oracle/page.tsx), this is only consulted to decide
  // whether today reads as a genuine no-op day for the cover's softened copy.
  hasCrisis: boolean;
}

// Clarity Phase 7/8 (Seeing Stone Reckoning P2, DAY-REALITY ADDENDUM #2) — the ritual
// gate: a hard cover over the mode shell until the morning ritual has run, Mike has used
// Quick-start, OR he's explicitly bailed. Never a passive/guilt-toned nag. The crisis lane
// is never inside this component — CrisisStrip renders as this component's SIBLING in
// oracle/page.tsx, above the cover, always visible.
//
// Three doors (the wireframe's approved look):
//   - Full ritual: NOT a "ritual is done" button — the real ritual runs machine-side as a
//     session with Bast, which is what actually POSTs `ran`. This door is purely
//     informational (a toast confirming the mechanism) — offering a manual "done" button
//     here would just be a second, easier-to-fake path to the same state.
//   - Quick-start: "name the one thing, go" — one input; submits a note-type Today pick
//     from the text, THEN satisfies the gate flagged quickstart (see useQuickStartRitual).
//     Never opens the gate on a failed pick-save.
//   - Bail: preserved verbatim — a decisive, logged act, never silent.
export function RitualGate({ children, hasCrisis }: RitualGateProps) {
  const { data: ritualStatus, isLoading: ritualLoading } = useRitualRunStatus();
  const { data: todayData, isLoading: picksLoading } = useTodayPicks();
  const bail = useBailRitual();
  const quickStart = useQuickStartRitual();
  const [quickstartText, setQuickstartText] = React.useState('');

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

  function handleQuickstart(e: React.FormEvent) {
    e.preventDefault();
    if (!quickstartText.trim()) {
      showToast.error('Name one thing to open the gate.');
      return;
    }
    quickStart.mutate({ text: quickstartText });
  }

  function handleFullRitual() {
    showToast.success('Start the ritual conversation with Bast — this gate lifts automatically once it runs.');
  }

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-lg border border-border-warm bg-surface px-6 py-10 text-center"
      data-testid="ritual-gate-cover"
    >
      <Moon className="h-6 w-6 text-text-sub" aria-hidden="true" />
      <p className="max-w-sm text-sm text-text-sub" data-testid="ritual-gate-copy">
        {ritualGateCopy(noOpDay)}
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button
          variant="primary"
          onClick={handleFullRitual}
          data-testid="ritual-gate-full-ritual"
          className="flex flex-col items-start gap-0.5 px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold">Full ritual</span>
          <span className="text-xs font-normal opacity-90">Walk the whole board — kanban, ledger, pipeline, week.</span>
        </Button>

        <div className="rounded-md border border-border-warm bg-background-light px-4 py-3 text-left">
          <p className="text-sm font-semibold text-text-main">Quick-start</p>
          <p className="text-xs text-text-sub">Name the one thing. Full ritual auto-offers when the wave breaks, around 11.</p>
          <form onSubmit={handleQuickstart} className="mt-2 flex gap-1.5">
            <Input
              value={quickstartText}
              onChange={(e) => setQuickstartText(e.target.value)}
              placeholder="the one thing today is…"
              data-testid="ritual-gate-quickstart-input"
              disabled={quickStart.isPending}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={quickStart.isPending} data-testid="ritual-gate-quickstart-submit">
              {quickStart.isPending ? <Spinner size="sm" /> : 'Go'}
            </Button>
          </form>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => bail.mutate('morning')}
          disabled={bail.isPending}
          data-testid="ritual-gate-bail"
          className="self-center text-text-sub underline underline-offset-4"
        >
          Not today.
        </Button>
      </div>

      <p className="max-w-sm text-xs text-text-sub">
        Foggy this morning? Say so in Quick-start — the day gets built small, no judgment.
      </p>
    </div>
  );
}
