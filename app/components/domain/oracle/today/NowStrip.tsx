'use client';

import type { TodayPick } from '@/lib/hooks/use-today';
import { computeNowStrip, nowStripReasonLabel } from './now-strip-logic';
import { TodayPickCard } from './TodayPickCard';

interface NowStripProps {
  picks: TodayPick[];
  todayDateStr: string;
  legacyAttentionArcIds?: Set<string>;
}

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the Now Strip (spec Q7): the top of
// TodaySection, up to 3 items — Doing-column picks first, then the earliest-sorted
// remaining uncompleted picks to fill to 3 — each carrying ONE honest reason chip. This is
// the execution view (research law: 1-3 items + reason, never blended with planning); the
// rest of Today still renders below it, unchanged, just visually secondary (see
// TodaySection.tsx). Renders nothing when there's nothing uncompleted to lead with.
export function NowStrip({ picks, todayDateStr, legacyAttentionArcIds }: NowStripProps) {
  const entries = computeNowStrip(picks, todayDateStr);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="now-strip">
      <h3 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">Now</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {entries.map(({ pick, reason }) => (
          <TodayPickCard
            key={pick.id}
            pick={pick}
            reasonLabel={nowStripReasonLabel(reason)}
            hasAttentionDot={!!pick.arc_id && !!legacyAttentionArcIds?.has(pick.arc_id)}
            testId="now-strip-pick-card"
          />
        ))}
      </div>
    </section>
  );
}
