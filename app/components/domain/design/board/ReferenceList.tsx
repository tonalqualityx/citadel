'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDecideReference, type BoardReference } from '@/lib/hooks/use-design-board';
import { ReferenceCard } from './ReferenceCard';

/** The live cards and the "Set aside" strip, shared by the Board and Inspiration tabs so there is one list. */
export function ReferenceList({ sessionId, refs, label }: { sessionId: string; refs: BoardReference[]; label: string }) {
  const decide = useDecideReference(sessionId);
  const [asideOpen, setAsideOpen] = React.useState(false);
  const asideId = React.useId();
  const live = refs.filter((r) => r.decision !== 'no');
  const aside = refs.filter((r) => r.decision === 'no');

  return (
    <>
      {live.length > 0 && (
        <ul className="space-y-4" aria-label={label}>
          {live.map((r) => <ReferenceCard key={r.id} sessionId={sessionId} reference={r} />)}
        </ul>
      )}

      {aside.length > 0 && (
        <section aria-label="Set aside" className="rounded-lg border border-border-warm bg-background-light p-3">
          <button
            type="button"
            aria-expanded={asideOpen}
            aria-controls={asideId}
            onClick={() => setAsideOpen((o) => !o)}
            className="flex min-h-[44px] items-center gap-2 rounded text-sm font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-9"
          >
            {asideOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            Set aside ({aside.length})
          </button>
          {asideOpen && (
            <ul id={asideId} className="mt-2 space-y-2">
              {aside.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-text-main" data-testid="set-aside-item">
                  <span className="min-w-0 flex-1">{r.title}{r.decision_note ? <span className="text-text-sub"> - {r.decision_note}</span> : null}</span>
                  <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" onClick={() => decide.mutate({ refId: r.id, decision: 'pending' })}>
                    Bring back<span className="sr-only"> {r.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
