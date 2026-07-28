'use client';

import * as React from 'react';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';
import type { AdminSoonTask } from '@/lib/hooks/use-admin-soon';
import { buildProcessDeck, currentCard, deckProgress } from './process-deck-logic';
import { IntakeDealCard } from './IntakeDealCard';
import { ReviewBatchDealCard } from './ReviewBatchDealCard';
import { AdminDealCard } from './AdminDealCard';

interface ProcessDealerProps {
  intakeAsks: EmailAsk[];
  reviewGroups: ReviewGroup[];
  adminTasks: AdminSoonTask[];
  nowMs: number;
}

// Clarity Phase 8 (composition) — the mode-escort law's "one card at a time" rule (#3):
// exactly ONE ProcessCard in the DOM ever, never a list-wall. The cursor is a routed-key
// set (see process-deck-logic.ts's doc comment) so a card that mutates away underneath
// (the common case — every real route action invalidates the underlying query) never gets
// skipped or repeated.
export function ProcessDealer({ intakeAsks, reviewGroups, adminTasks, nowMs }: ProcessDealerProps) {
  const [routed, setRouted] = React.useState<Set<string>>(new Set());

  const deck = React.useMemo(
    () => buildProcessDeck({ intakeAsks, reviewGroups, adminTasks }),
    [intakeAsks, reviewGroups, adminTasks]
  );
  const card = currentCard(deck, routed);
  const progress = deckProgress(deck, routed);

  function markRouted(key: string) {
    setRouted((prev) => new Set(prev).add(key));
  }

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-warm px-6 py-10 text-center" data-testid="process-dealer-empty">
        <p className="text-sm text-text-sub">Nothing to process. The queue is clear.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="process-dealer">
      <p className="text-xs text-text-sub" data-testid="process-dealer-progress">
        {progress.done} of {progress.total} cleared
      </p>
      {card.stage === 'intake' && (
        <IntakeDealCard ask={card.ask} onRouted={() => markRouted(card.key)} />
      )}
      {card.stage === 'review' && (
        <ReviewBatchDealCard group={card.group} nowMs={nowMs} onRouted={() => markRouted(card.key)} />
      )}
      {card.stage === 'admin' && (
        <AdminDealCard task={card.task} onRouted={() => markRouted(card.key)} />
      )}
    </div>
  );
}
