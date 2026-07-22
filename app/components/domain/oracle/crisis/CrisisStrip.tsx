'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';
import { useUpdateEmailAsk } from '@/lib/hooks/use-email-asks';
import { crisisFromLabel, hasCrisis, SEVERITY_LABEL } from './crisis-strip-logic';

interface CrisisStripProps {
  crisis: EmailAsk[];
}

// Clarity Phase 4a — the crisis strip. Renders ONLY when there's an open+urgent email ask
// (exception-based: zero pixels when calm, per Mike's talk-first ruling). Error-family
// treatment (same tokens TimeShape's meeting blocks use — see the comment there: the
// research "no red" rule targets overdue/aging displays, not an active crisis, which Mike
// explicitly wants loud). Mobile: full-width, never collapsed — this is not a queue that
// gets tucked away.
export function CrisisStrip({ crisis }: CrisisStripProps) {
  const updateAsk = useUpdateEmailAsk();

  if (!hasCrisis(crisis)) return null;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border-2 p-3"
      style={{ backgroundColor: 'var(--error-subtle)', borderColor: 'var(--error)' }}
      data-testid="crisis-strip"
      role="alert"
    >
      <h2
        className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"
        style={{ color: 'var(--error)' }}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Crisis · {crisis.length}
      </h2>

      <div className="flex flex-col gap-2">
        {crisis.map((ask) => (
          <div
            key={ask.id}
            className="flex flex-col gap-1 rounded-md border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: 'var(--error)' }}
            data-testid="crisis-card"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-sub">
                <span className="truncate">From: {crisisFromLabel(ask)}</span>
                {ask.severity && (
                  <span
                    className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: 'var(--error-subtle)', color: 'var(--error)' }}
                  >
                    {SEVERITY_LABEL[ask.severity]}
                  </span>
                )}
              </div>
              <p className="truncate text-sm font-semibold text-text-main">{ask.subject}</p>
              {ask.gist && <p className="truncate text-sm text-text-sub">{ask.gist}</p>}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button asChild variant="primary" size="sm">
                <a href={ask.deep_link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open email
                </a>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => updateAsk.mutate({ id: ask.id, data: { state: 'handled' } })}
                disabled={updateAsk.isPending}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Handled
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
