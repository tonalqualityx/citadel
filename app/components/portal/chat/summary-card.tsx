'use client';

import { useState } from 'react';
import { FileText, MessageSquare, Send, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Field } from '@/components/portal/ui/field';
import { PROJECT_SELECT_PROMPT, SUMMARY_HEADING } from '@/lib/portal/intake/tree';
import { SUMMARY_LABELS } from '@/lib/portal/chat/copy';
import { canPreview, type SummaryPending } from './types';

// "Here is what we will send." The rows, the files, where it goes, the quote or urgent line (fixed
// copy from the server, never the assistant's words), then Send to the team or Change something.
export function SummaryCard({
  summary, busy, error, onSend, onChange,
}: {
  summary: SummaryPending;
  busy: boolean;
  error: string | null;
  onSend: (projectId: string | null) => void;
  onChange: () => void;
}) {
  const [project, setProject] = useState('');
  const needsPick = Boolean(summary.choose_project) && !project;
  return (
    <section aria-labelledby="chat-summary-heading" className="summary-card" data-testid="chat-summary">
      <h2 id="chat-summary-heading">{SUMMARY_HEADING}</h2>
      {summary.text ? <p className="pre">{summary.text}</p> : null}
      <dl>
        {summary.rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className="pre">{r.value}</dd>
          </div>
        ))}
        {summary.files.length > 0 && (
          <div>
            <dt>{SUMMARY_LABELS.files}</dt>
            <dd>
              <ul className="sum-files">
                {summary.files.map((f) => (
                  <li key={f.id}>
                    {canPreview(f.type) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="thumb" />
                    ) : (
                      <span className="thumb file" aria-hidden="true">
                        <FileText className="i" focusable="false" />
                      </span>
                    )}
                    <span>{f.name}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {summary.choose_project && (
        <Field id="chat-project" label={PROJECT_SELECT_PROMPT}>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Choose a project</option>
            {summary.choose_project.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {summary.destination ? (
        <p className="dest">
          <MessageSquare className="i" aria-hidden="true" focusable="false" />
          <span>{summary.destination}</span>
        </p>
      ) : null}
      {summary.quote_line ? <p className="meta">{summary.quote_line}</p> : null}
      {summary.urgent_line ? <p className="strong">{summary.urgent_line}</p> : null}
      {error && (
        <p className="err" role="alert">
          <TriangleAlert className="i" aria-hidden="true" focusable="false" />
          {error}
        </p>
      )}
      <div className="composer">
        <div className="actions">
          <PortalButton icon={Send} busy={busy} busyLabel="Sending…" disabled={needsPick} onClick={() => onSend(project || null)}>
            {summary.buttons.send}
          </PortalButton>
          <PortalButton variant="secondary" disabled={busy} onClick={onChange}>
            {summary.buttons.change}
          </PortalButton>
        </div>
      </div>
    </section>
  );
}
