'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/time';
import type { OracleProjectLinkedEmail } from '@/lib/hooks/use-oracle-projects';

interface EmailSummaryProps {
  summary: string | null;
  summaryAt: string | null;
  emails: OracleProjectLinkedEmail[];
}

// Oracle Projects Tab Phase 4 — the drawer's Email summary section: the running summary
// text the machine-side job writes, stamped with when it was last written, followed by
// every email linked to this project with a deep link into the real Gmail thread.
export function EmailSummary({ summary, summaryAt, emails }: EmailSummaryProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="email-summary">
      {summary ? (
        <div>
          <p className="text-sm text-text-main">{summary}</p>
          {summaryAt && (
            <p className="mt-1 text-xs text-text-sub">Updated {formatRelativeTime(summaryAt)}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-sub">No summary yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {emails.length === 0 && <p className="text-sm text-text-sub">No linked emails.</p>}
        {emails.map((email) => (
          <div
            key={email.id}
            className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-text-main">{email.subject}</div>
              <div className="text-xs text-text-sub">
                {email.from} · {formatRelativeTime(email.received_at)}
                {!email.replied && <span style={{ color: 'var(--warning)' }}> · unreplied</span>}
              </div>
              {email.gist && <div className="mt-1 text-xs text-text-sub">{email.gist}</div>}
            </div>
            <Link
              href={email.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
