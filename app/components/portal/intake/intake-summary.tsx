'use client';

import { MessageSquare, Send, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Field } from '@/components/portal/ui/field';
import {
  BUTTONS,
  EMERGENCY_LINE,
  PROJECT_SELECT_PROMPT,
  QUOTE_LINE,
  SUMMARY_HEADING,
  dateEcho,
} from '@/lib/portal/intake/tree';

// "Here is what we will send." Type, site, the answers verbatim, and one line saying where the
// request goes. A quote adds the quote line, an emergency adds the urgent line, two open builds
// on the site add a select. Nothing here promises a date or a price.
export interface SummaryProps {
  typeLabel: string;
  siteName: string | null;
  answers: Array<{ prompt: string; value: string }>;
  destination: string;
  quote: boolean;
  urgent: boolean;
  dateWords: string | null;
  projectChoices: Array<{ id: string; name: string }> | null;
  chosenProjectId: string;
  onChooseProject: (id: string) => void;
  sending: boolean;
  error: string | null;
  onSend: () => void;
  onChange: () => void;
  onCancel: () => void;
}

export function IntakeSummary(p: SummaryProps) {
  const needsPick = Boolean(p.projectChoices) && !p.chosenProjectId;
  return (
    <section aria-labelledby="intake-summary-heading" className="summary-card">
      <h2 id="intake-summary-heading">{SUMMARY_HEADING}</h2>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{p.typeLabel}</dd>
        </div>
        {p.siteName && (
          <div>
            <dt>Site</dt>
            <dd>{p.siteName}</dd>
          </div>
        )}
        {p.answers.map((a) => (
          <div key={a.prompt}>
            <dt>{a.prompt}</dt>
            <dd className="pre">{a.value}</dd>
          </div>
        ))}
      </dl>
      {p.projectChoices && (
        <Field id="intake-project" label={PROJECT_SELECT_PROMPT}>
          <select value={p.chosenProjectId} onChange={(e) => p.onChooseProject(e.target.value)}>
            <option value="">Choose a project</option>
            {p.projectChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {p.destination ? (
        <p className="dest">
          <MessageSquare className="i" aria-hidden="true" focusable="false" />
          <span>{p.destination}</span>
        </p>
      ) : null}
      {p.quote && <p className="meta">{QUOTE_LINE}</p>}
      {p.urgent && <p className="strong">{EMERGENCY_LINE}</p>}
      {p.dateWords && <p className="meta">{dateEcho(p.dateWords)}</p>}
      <div className="composer">
        {p.error && (
          <p role="alert" className="err">
            <TriangleAlert className="i" aria-hidden="true" focusable="false" />
            {p.error}
          </p>
        )}
        <div className="actions">
          <PortalButton
            writes
            icon={Send}
            busy={p.sending}
            busyLabel="Sending…"
            disabled={needsPick}
            onClick={p.onSend}
          >
            {BUTTONS.send}
          </PortalButton>
          <PortalButton variant="secondary" onClick={p.onChange}>
            {BUTTONS.change}
          </PortalButton>
          <PortalButton variant="quiet" onClick={p.onCancel}>
            {BUTTONS.cancel}
          </PortalButton>
        </div>
      </div>
    </section>
  );
}
