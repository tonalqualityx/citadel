'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTodayPicks, useCreateTodayPick } from '@/lib/hooks/use-today';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { showToast } from '@/lib/hooks/use-toast';
import { commandAge } from '@/components/domain/oracle/oracle-logic';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';

interface ReviewBatchDealCardProps {
  group: ReviewGroup;
  nowMs: number;
  onRouted: () => void;
}

// Clarity Phase 8 (composition) — Process mode's review-batch card, one at a time.
// "Pick arc → Today" is the same pick-the-arc mechanism ReviewGroupCard already uses
// (Clarity Phase 3 Reckoning spec Q5).
//
// Clarity Phase 8 (shakedown, 2026-07-28) — Mike clicked what used to be this card's
// "Open" button expecting to see the batch's details; it just silently advanced past the
// card instead (the button's ONLY effect was `onRouted`, a session-local skip — nothing
// was ever "opened"). Two fixes: the ghost button is honestly named "Skip" now (it always
// only skipped), and a real "View details" control expands the batch's items INLINE,
// without advancing past the card, so looking is no longer confused with dismissing.
export function ReviewBatchDealCard({ group, nowMs, onRouted }: ReviewBatchDealCardProps) {
  const { data: todayData } = useTodayPicks();
  const createPick = useCreateTodayPick();
  const { openTaskPeek } = useTaskPeek();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const ageLabel = group.oldestWaitAt ? commandAge(group.oldestWaitAt, nowMs) : null;

  const alreadyPicked = !!group.arcId && (todayData?.picks ?? []).some(
    (p) => p.item_type === 'arc' && p.arc_id === group.arcId && !p.completed_at
  );

  function handlePick() {
    if (!group.arcId) return;
    // Clarity Phase 8 (shakedown) — createPick (POST /today) has no success toast of its
    // own (unlike the plain toggle path, this is a genuinely new, non-obvious change of
    // state) — say plainly what just happened rather than leaving the vanished button as
    // the only clue.
    const arcName = group.items[0]?.contextLabel ?? group.label;
    createPick.mutate(
      { item_type: 'arc', arc_id: group.arcId },
      {
        onSuccess: () => {
          showToast.success(`Added ${arcName} to Today`);
          onRouted();
        },
      }
    );
  }

  function handleSkip() {
    showToast.success('Skipped — still in the queue');
    onRouted();
  }

  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="process-deal-card" data-stage="review">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-text-main">
        {group.label}
        <span className="rounded-full border border-border-warm bg-background-light px-2 text-xs text-text-sub">
          {group.count}
        </span>
      </div>
      <p className="text-xs text-text-sub">
        {group.topItemTitle}
        {ageLabel && ` · oldest ${ageLabel}`}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {group.arcId && !alreadyPicked && (
          <Tooltip content="Adds this arc to today's picks — the review batch becomes one card to work from">
            <Button
              variant="primary"
              size="sm"
              onClick={handlePick}
              disabled={createPick.isPending}
              data-testid="review-deal-pick-arc"
            >
              Pick arc → Today
            </Button>
          </Tooltip>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          data-testid="review-deal-view-details"
        >
          {detailsOpen ? 'Hide details' : 'View details'}
        </Button>
        <Tooltip content="Skip for now — stays in the queue">
          <Button variant="ghost" size="sm" onClick={handleSkip} data-testid="review-deal-open">
            Skip
          </Button>
        </Tooltip>
      </div>

      {detailsOpen && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border-warm pt-2" data-testid="review-deal-details">
          {group.items.length === 0 ? (
            <p className="text-xs text-text-sub">No items in this batch.</p>
          ) : (
            group.items.map((item) => {
              const itemAge = item.waitingSince ? commandAge(item.waitingSince, nowMs) : null;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-warm bg-background-light/40 px-2 py-1.5"
                  data-testid="review-deal-detail-item"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-text-main">{item.bodyText}</p>
                    {itemAge && <p className="text-xs text-text-sub">waiting {itemAge}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.primaryAction.kind === 'open_review' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openTaskPeek(item.primaryAction.kind === 'open_review' ? item.primaryAction.taskId : '')}
                        data-testid="review-deal-detail-open-task"
                      >
                        Open task
                      </Button>
                    )}
                    {item.primaryAction.kind === 'respond' && (
                      <Button asChild variant="ghost" size="sm">
                        <a href={item.primaryAction.remoteUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Respond
                        </a>
                      </Button>
                    )}
                    {item.primaryAction.kind === 'none' && item.arcId && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/oracle/arcs/${item.arcId}`}>Open arc</Link>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </Card>
  );
}
