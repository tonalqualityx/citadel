'use client';

import * as React from 'react';
import { Inbox, CheckSquare, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { AskCard } from './AskCard';
import { ReviewGroupCard } from './ReviewGroupCard';
import { capColumnCards } from '@/lib/kanban-caps';
import { buildWaitingColumn, groupReviewByClient } from './needs-reshi-logic';

interface NeedsReshiProps {
  data: WaitingOnMeResponse;
  liveSessions: OracleSessionWithMachine[];
  nowMs: number;
}

// Mobile-only collapse toggle for a queue header. On desktop the queue is always
// expanded (per the mobile hard rule below), so the header renders as plain, non-
// interactive text there instead of a <button> whose onClick would be a no-op —
// a control that looks clickable but does nothing on desktop is worse than no
// control at all.
function QueueHeader({
  icon: Icon,
  label,
  count,
  isMobile,
  collapsedOnMobile,
  onToggle,
}: {
  icon: typeof Inbox;
  label: string;
  count: number;
  isMobile: boolean;
  collapsedOnMobile: boolean;
  onToggle: () => void;
}) {
  const content = (
    <>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
      <span className="rounded-full border border-border-warm bg-background-light px-2 text-xs text-text-sub">
        {count}
      </span>
      {isMobile && (
        <ChevronRight
          className={cn('h-3.5 w-3.5 text-text-sub transition-transform', !collapsedOnMobile && 'rotate-90')}
        />
      )}
    </>
  );

  if (!isMobile) {
    return (
      <div className="flex min-h-9 items-center gap-1.5 rounded px-1 text-left text-sm font-semibold text-text-main">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsedOnMobile}
      className="flex min-h-9 items-center gap-1.5 rounded px-1 text-left text-sm font-semibold text-text-main"
    >
      {content}
    </button>
  );
}

// Clarity Phase 5 rework (Mike's ruling, 2026-07-22): Decide + Answer merge into ONE
// "Waiting on you" queue (declared session asks, type-chipped decision/reply — see
// needs-reshi-logic.ts's buildWaitingColumn). Legacy hook-flagged needs_attention sessions
// with NO declared ask are REMOVED from this screen entirely: linked-to-an-arc ones become
// a quiet attention dot on the arc's own card (Today strip + Soothsayer — see
// oracle-logic.ts's legacyNeedsAttentionArcIds), unlinked ones move to the Fleet screen
// (WaitingStrip). Review groups by client (fallback arc, then "Other"). DO-work (the `do`
// group) never appears here — it lives as quests, surfaced through Today and the ritual.
// Kanban density caps still apply (max 4 columns — this uses 2 — 5-7 visible cards, "+N
// more" overflow).
export function NeedsReshi({ data, liveSessions, nowMs }: NeedsReshiProps) {
  const isMobile = useIsMobile();
  // Mobile hard rule: queues collapse to counts (tap to expand). Desktop always shows
  // full cards, matching the mockup exactly — this state only ever gates the mobile view.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const remoteUrlByExternalId = new Map(
    liveSessions.filter((s) => s.remote_url).map((s) => [s.external_id, s.remote_url])
  );

  const waitingResult = buildWaitingColumn(data.waiting, remoteUrlByExternalId);
  const reviewGroupResult = capColumnCards(groupReviewByClient(data.review));

  const totalCards = data.waiting.length + data.review.length;
  if (totalCards === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const waitingCollapsedOnMobile = isMobile && !expanded.has('waiting');
  const reviewCollapsedOnMobile = isMobile && !expanded.has('review');

  return (
    <section className="flex flex-col gap-2" data-testid="needs-reshi-section">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">Needs Reshi</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2" data-testid="needs-reshi-column-waiting">
          <QueueHeader
            icon={Inbox}
            label="Waiting on you"
            count={data.waiting.length}
            isMobile={isMobile}
            collapsedOnMobile={waitingCollapsedOnMobile}
            onToggle={() => toggle('waiting')}
          />

          {!waitingCollapsedOnMobile && (
            <>
              <div className="flex flex-col gap-2">
                {waitingResult.visible.map((card) => (
                  <AskCard key={card.id} data={card} />
                ))}
              </div>
              {waitingResult.overflowCount > 0 && (
                <div className="px-1 text-center text-xs text-text-sub">
                  + {waitingResult.overflowCount} more · opens the full queue
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2" data-testid="needs-reshi-column-review">
          <QueueHeader
            icon={CheckSquare}
            label="Review"
            count={data.review.length}
            isMobile={isMobile}
            collapsedOnMobile={reviewCollapsedOnMobile}
            onToggle={() => toggle('review')}
          />

          {!reviewCollapsedOnMobile && (
            <div className="flex flex-col gap-2">
              {reviewGroupResult.visible.map((group) => (
                <ReviewGroupCard key={group.key} group={group} nowMs={nowMs} />
              ))}
              {reviewGroupResult.overflowCount > 0 && (
                <div className="px-1 text-center text-xs text-text-sub">
                  + {reviewGroupResult.overflowCount} more groups
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
