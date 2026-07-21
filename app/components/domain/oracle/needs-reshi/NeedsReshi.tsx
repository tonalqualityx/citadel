'use client';

import * as React from 'react';
import { Sparkles, Mail, CheckSquare, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { WaitingOnMeCard, WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { AskCard } from './AskCard';
import { capColumnCards } from '@/lib/kanban-caps';

interface NeedsReshiProps {
  data: WaitingOnMeResponse;
  liveSessions: OracleSessionWithMachine[];
}

const COLUMNS: { key: 'decide' | 'answer' | 'review'; title: string; icon: typeof Sparkles }[] = [
  { key: 'decide', title: 'Decide', icon: Sparkles },
  { key: 'answer', title: 'Answer', icon: Mail },
  { key: 'review', title: 'Review', icon: CheckSquare },
];

// Decide/Answer/Review columns from /api/waiting-on-me + live session asks. DO-work
// (the `do` group) never appears here — it lives as quests, surfaced through Today and the
// ritual, per the mockup's own design note. Kanban density caps apply here too (max 4
// columns — this uses 3 — 5-7 visible cards, "+N more" overflow) since a dense queue is
// exactly where the caps are load-bearing.
export function NeedsReshi({ data, liveSessions }: NeedsReshiProps) {
  const isMobile = useIsMobile();
  // Mobile hard rule: queues collapse to counts (tap to expand). Desktop always shows
  // full cards, matching the mockup exactly — this state only ever gates the mobile view.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const remoteUrlByExternalId = new Map(
    liveSessions.filter((s) => s.remote_url).map((s) => [s.external_id, s.remote_url])
  );

  const totalCards = data.decide.length + data.answer.length + data.review.length;
  if (totalCards === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-2" data-testid="needs-reshi-section">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-text-sub">Needs Reshi</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map(({ key, title, icon: Icon }) => {
          const cards: WaitingOnMeCard[] = data[key];
          const { visible, overflowCount } = capColumnCards(cards);
          const collapsedOnMobile = isMobile && !expanded.has(key);
          return (
            <div key={key} className="flex flex-col gap-2" data-testid={`needs-reshi-column-${key}`}>
              <button
                type="button"
                onClick={() => isMobile && toggle(key)}
                aria-expanded={!collapsedOnMobile}
                className="flex min-h-9 items-center gap-1.5 rounded px-1 text-left text-sm font-semibold text-text-main"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {title}
                <span className="rounded-full border border-border-warm bg-background-light px-2 text-xs text-text-sub">
                  {cards.length}
                </span>
                {isMobile && (
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 text-text-sub transition-transform', !collapsedOnMobile && 'rotate-90')}
                  />
                )}
              </button>

              {!collapsedOnMobile && (
                <>
                  <div className="flex flex-col gap-2">
                    {visible.map((card) => (
                      <AskCard
                        key={card.id}
                        card={card}
                        remoteUrl={
                          card.session_external_id
                            ? remoteUrlByExternalId.get(card.session_external_id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  {overflowCount > 0 && (
                    <div className="px-1 text-center text-xs text-text-sub">
                      + {overflowCount} more · opens the full queue
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
