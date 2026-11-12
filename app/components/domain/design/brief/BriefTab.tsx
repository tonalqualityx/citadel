'use client';

import * as React from 'react';
import { useDesignBrief } from '@/lib/hooks/use-design-brief';
import { BriefCard } from './BriefCard';
import { BriefDrawer } from './BriefDrawer';
import { ClientQuote } from './ClientQuote';
import { cardStatements, orderedSections, statementsById, type BriefCardData } from './brief-model';
import type { TrackTabProps } from '../track-tab-props';

/** The Brief tab (SPEC 4.1): cards grouped by section in the fixed order, a drawer for the detail and the sources. */
export function BriefTab({ sessionId, feed }: TrackTabProps) {
  const q = useDesignBrief(sessionId, feed?.next_poll_ms);
  const [openCard, setOpenCard] = React.useState<BriefCardData | null>(null);
  const opener = React.useRef<HTMLElement | null>(null);

  if (q.isLoading) return <p role="status" className="p-4 text-sm text-text-sub">Loading the brief...</p>;
  if (q.isError && !q.data) return <p role="alert" className="p-4 text-sm text-red-700">The brief could not be loaded. It will try again shortly.</p>;
  const data = q.data;
  if (!data || !data.brief) {
    return (
      <p role="status" className="p-4 text-sm text-text-sub" data-testid="brief-empty">
        The research for this site is still being prepared. The brief will show up here as soon as it is ready.
      </p>
    );
  }

  const body = data.brief.body;
  const byId = statementsById(data.client_statements);
  const reactions = new Map(data.reactions.map((r) => [r.card_id, r]));
  const sections = orderedSections(body);
  const hasSaidSection = sections.some((s) => s.id === 'client_said');
  const bySubject = new Map<string, typeof data.client_statements>();
  if (!hasSaidSection) for (const st of data.client_statements) bySubject.set(st.subject, [...(bySubject.get(st.subject) ?? []), st]);

  return (
    <div className="space-y-6 p-3">
      <p className="text-sm text-text-main" data-testid="brief-one-line">{body.one_line}</p>
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`brief-${section.id}`} data-testid="brief-section" data-section={section.id}>
          <h3 id={`brief-${section.id}`} className="mb-2 text-base font-semibold text-text-main">{section.title}</h3>
          {section.cards.length === 0 ? (
            <p className="text-sm text-text-sub">Nothing to show in this part yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {section.cards.map((card) => (
                <BriefCard
                  key={card.id}
                  sessionId={sessionId}
                  card={card}
                  data={data}
                  statements={section.id === 'client_said' ? cardStatements(card, byId) : []}
                  reaction={reactions.get(card.id)}
                  onOpen={(c, el) => { opener.current = el; setOpenCard(c); }}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
      {!hasSaidSection && data.client_statements.length > 0 && (
        <section aria-labelledby="brief-client-said-fallback" data-testid="brief-section" data-section="client_said">
          <h3 id="brief-client-said-fallback" className="mb-2 text-base font-semibold text-text-main">What the client said</h3>
          <div className="space-y-3">
            {[...bySubject.entries()].map(([subject, list]) => (
              <div key={subject} className="space-y-2">
                <h4 className="text-sm font-semibold text-text-main">{subject}</h4>
                {list.map((s) => <ClientQuote key={s.id} statement={s} />)}
              </div>
            ))}
          </div>
        </section>
      )}
      <BriefDrawer
        sessionId={sessionId}
        card={openCard}
        data={data}
        statementsById={byId}
        onClose={() => setOpenCard(null)}
        returnFocusRef={opener}
      />
    </div>
  );
}
