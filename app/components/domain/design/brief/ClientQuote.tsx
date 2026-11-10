'use client';

import type { ClientStatementView } from '@/lib/hooks/use-design-brief';
import { PARAPHRASE_LABEL, formatDate } from './brief-model';

/** One thing the client said. A paraphrase carries the label and no quotation marks: it is not their exact words. */
export function ClientQuote({ statement }: { statement: ClientStatementView }) {
  const date = formatDate(statement.source_date);
  const who = [statement.speaker_name, statement.speaker_role].filter(Boolean).join(', ');
  return (
    <figure className="rounded-md border-l-4 border-border-warm bg-background-light px-3 py-2" data-testid="client-quote">
      {statement.is_paraphrase && (
        <p className="mb-1 text-xs font-semibold text-text-main" data-testid="paraphrase-label">{PARAPHRASE_LABEL}</p>
      )}
      <blockquote className="text-sm text-text-main">
        {statement.is_paraphrase ? statement.quote : `“${statement.quote}”`}
      </blockquote>
      <figcaption className="mt-1 text-xs text-text-sub">
        {who}
        {who && date ? ', ' : ''}
        {date}
      </figcaption>
    </figure>
  );
}
