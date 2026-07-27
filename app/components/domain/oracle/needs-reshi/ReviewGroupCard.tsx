'use client';

import * as React from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTodayPicks, useCreateTodayPick } from '@/lib/hooks/use-today';
import { commandAge } from '../oracle-logic';
import { AskCard } from './AskCard';
import type { ReviewGroup } from './needs-reshi-logic';

interface ReviewGroupCardProps {
  group: ReviewGroup;
  nowMs: number;
}

// Clarity Phase 5 — Review grouped by client (fallback arc, then "Other"): one card per
// group with count + oldest-wait age + the top (longest-waiting) item's title, collapsed by
// default; expanding shows the individual items via the SAME per-item AskCard/peek-drawer
// flow the old flat wall used — the 13-card wall becomes ~3 group cards, not a new
// navigation pattern.
// Clarity Phase 3 (Seeing Stone Reckoning, spec Q5) — "Add to Today" for a review batch
// whose items all share one arc: creates an arc-type Today pick for that arc (pick-the-
// arc, per Mike's ruling — a new pick TYPE was only ever needed for the ungrouped
// "Other" case, out of scope this round). Idempotent-guarded client-side: hidden once
// that arc is already an uncompleted pick for today.
function AddToTodayButton({ arcId }: { arcId: string }) {
  const { data: todayData } = useTodayPicks();
  const createPick = useCreateTodayPick();

  const alreadyPicked = (todayData?.picks ?? []).some(
    (p) => p.item_type === 'arc' && p.arc_id === arcId && !p.completed_at
  );
  if (alreadyPicked) return null;

  return (
    <Tooltip content="Adds this arc to today's picks — the review batch becomes one card to work from">
      <Button
        variant="secondary"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          createPick.mutate({ item_type: 'arc', arc_id: arcId });
        }}
        disabled={createPick.isPending}
        data-testid="review-group-add-to-today"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add to Today
      </Button>
    </Tooltip>
  );
}

export function ReviewGroupCard({ group, nowMs }: ReviewGroupCardProps) {
  const [open, setOpen] = React.useState(false);
  const ageLabel = group.oldestWaitAt ? commandAge(group.oldestWaitAt, nowMs) : null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-border-warm bg-surface p-3"
      data-testid="review-group-card"
      data-group-key={group.key}
    >
      {/* Two siblings, not a button-in-a-button: the toggle needs to stay a <button>
          (native keyboard/focus semantics) but AddToTodayButton is its own interactive
          button — nesting them would be invalid HTML (and a real hydration error), so
          the chevron/toggle button wraps only the label/count/top-item, with the Add-
          to-Today button living beside it, not inside it. */}
      <div className="flex w-full items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-1.5 text-sm font-semibold text-text-main">
            <span className="truncate">{group.label}</span>
            <span className="rounded-full border border-border-warm bg-background-light px-2 text-xs text-text-sub">
              {group.count}
            </span>
          </div>
          <div className="truncate text-xs text-text-sub" data-testid="review-group-top-item">
            {group.topItemTitle}
            {ageLabel && ` · waiting ${ageLabel}`}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {group.arcId && <AddToTodayButton arcId={group.arcId} />}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Collapse group' : 'Expand group'}
            className="flex h-6 w-6 items-center justify-center rounded text-text-sub hover:bg-background-light"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-2 pt-1" data-testid="review-group-items">
          {group.items.map((item) => (
            <AskCard key={item.id} data={item} />
          ))}
        </div>
      )}
    </div>
  );
}
