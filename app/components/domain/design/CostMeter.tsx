'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { TurnCost } from '@/lib/design/feed-reducer';
import { BudgetDialog } from './BudgetDialog';

const usd = (n: number) => `$${n.toFixed(2)}`;

export interface CostMeterProps {
  sessionId: string;
  costUsd: number;
  budgetUsd: number;
  lastTurn: TurnCost | null;
  /** Raising is possible while the session is not closed. */
  canRaise: boolean;
  pausedForBudget?: boolean;
}

// Running total against the ceiling, plus the last turn (design 11).
export function CostMeter({ sessionId, costUsd, budgetUsd, lastTurn, canRaise, pausedForBudget }: CostMeterProps) {
  const [open, setOpen] = React.useState(false);
  const pct = budgetUsd > 0 ? Math.min(100, Math.round((costUsd / budgetUsd) * 100)) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-sub" data-testid="cost-meter">
      <div className="min-w-[8rem] flex-1">
        <div className="flex justify-between">
          <span>Spent <strong className="text-text-main">{usd(costUsd)}</strong></span>
          <span>Ceiling {usd(budgetUsd)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-background-light" role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? 'var(--warning)' : 'var(--primary)' }} />
        </div>
      </div>
      <span data-testid="last-turn">Last turn {lastTurn ? usd(lastTurn.turn_usd) : 'none yet'}</span>
      {canRaise && (
        <Button type="button" size="sm" variant={pausedForBudget ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
          Raise budget
        </Button>
      )}
      <BudgetDialog sessionId={sessionId} currentBudget={budgetUsd} open={open} onOpenChange={setOpen} />
    </div>
  );
}
