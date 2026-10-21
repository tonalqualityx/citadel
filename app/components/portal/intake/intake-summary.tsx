'use client';

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
    <section aria-labelledby="intake-summary-heading" className="space-y-4">
      <h2 id="intake-summary-heading" className="text-lg font-semibold text-text-main">
        {SUMMARY_HEADING}
      </h2>
      <dl className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <div>
          <dt className="text-text-tertiary">Type</dt>
          <dd className="font-medium text-text-main">{p.typeLabel}</dd>
        </div>
        {p.siteName && (
          <div>
            <dt className="text-text-tertiary">Site</dt>
            <dd className="font-medium text-text-main">{p.siteName}</dd>
          </div>
        )}
        {p.answers.map((a) => (
          <div key={a.prompt}>
            <dt className="text-text-tertiary">{a.prompt}</dt>
            <dd className="whitespace-pre-wrap text-text-main">{a.value}</dd>
          </div>
        ))}
      </dl>
      {p.projectChoices && (
        <div>
          <label htmlFor="intake-project" className="mb-1 block text-sm font-medium text-text-main">
            {PROJECT_SELECT_PROMPT}
          </label>
          <select
            id="intake-project"
            value={p.chosenProjectId}
            onChange={(e) => p.onChooseProject(e.target.value)}
            className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-text-main"
          >
            <option value="">Choose a project</option>
            {p.projectChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-sm text-text-main">{p.destination}</p>
      {p.quote && <p className="text-sm text-text-secondary">{QUOTE_LINE}</p>}
      {p.urgent && <p className="text-sm font-semibold text-text-main">{EMERGENCY_LINE}</p>}
      {p.dateWords && <p className="text-sm text-text-secondary">{dateEcho(p.dateWords)}</p>}
      {p.error && (
        <p role="alert" className="text-sm text-status-error">
          {p.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={p.sending || needsPick}
          onClick={p.onSend}
          className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {p.sending ? 'Sending…' : BUTTONS.send}
        </button>
        <button
          type="button"
          onClick={p.onChange}
          className="min-h-[44px] rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {BUTTONS.change}
        </button>
        <button type="button" onClick={p.onCancel} className="min-h-[44px] px-2 text-sm text-text-secondary underline">
          {BUTTONS.cancel}
        </button>
      </div>
    </section>
  );
}
