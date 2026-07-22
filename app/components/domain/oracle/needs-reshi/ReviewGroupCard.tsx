'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
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
export function ReviewGroupCard({ group, nowMs }: ReviewGroupCardProps) {
  const [open, setOpen] = React.useState(false);
  const ageLabel = group.oldestWaitAt ? commandAge(group.oldestWaitAt, nowMs) : null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-border-warm bg-surface p-3"
      data-testid="review-group-card"
      data-group-key={group.key}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0">
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
        </div>
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 text-text-sub transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
      </button>

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
