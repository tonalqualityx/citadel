'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTodayPicks, useCreateTodayPick } from '@/lib/hooks/use-today';
import { commandAge } from '@/components/domain/oracle/oracle-logic';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';

interface ReviewBatchDealCardProps {
  group: ReviewGroup;
  nowMs: number;
  onRouted: () => void;
}

// Clarity Phase 8 (composition) — Process mode's review-batch card, one at a time.
// "Pick arc → Today" is the same pick-the-arc mechanism ReviewGroupCard already uses
// (Clarity Phase 3 Reckoning spec Q5); "Open" advances past this card without picking
// (session-local skip — the group is still there tomorrow, nothing is lost).
export function ReviewBatchDealCard({ group, nowMs, onRouted }: ReviewBatchDealCardProps) {
  const { data: todayData } = useTodayPicks();
  const createPick = useCreateTodayPick();
  const ageLabel = group.oldestWaitAt ? commandAge(group.oldestWaitAt, nowMs) : null;

  const alreadyPicked = !!group.arcId && (todayData?.picks ?? []).some(
    (p) => p.item_type === 'arc' && p.arc_id === group.arcId && !p.completed_at
  );

  function handlePick() {
    if (!group.arcId) return;
    createPick.mutate({ item_type: 'arc', arc_id: group.arcId }, { onSuccess: onRouted });
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
        <Button variant="ghost" size="sm" onClick={onRouted} data-testid="review-deal-open">
          Open
        </Button>
      </div>
    </Card>
  );
}
