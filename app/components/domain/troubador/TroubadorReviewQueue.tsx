'use client';

import * as React from 'react';
import Link from 'next/link';
import { PenLine } from 'lucide-react';
import { useTroubadorEditorQueue } from '@/lib/hooks/use-troubador';
import { DashboardSection } from '@/components/domain/dashboard/dashboard-section';

/**
 * Self-contained PM dashboard section surfacing the current editor's Troubador
 * action items: articles awaiting review + runs needing their attention. Fetches
 * its own data so it doesn't depend on the server dashboard aggregation. Renders
 * nothing when the queue is empty.
 */
export function TroubadorReviewQueue() {
  const { data } = useTroubadorEditorQueue();

  if (!data) return null;

  const reviews = data.articles_awaiting_review ?? [];
  const planning = data.runs_in_planning ?? [];
  const topicSelection = data.runs_in_topic_selection ?? [];
  const interview = data.runs_ready_for_interview ?? [];

  const total =
    reviews.length + planning.length + topicSelection.length + interview.length;
  if (total === 0) return null;

  return (
    <DashboardSection
      title="Troubador — Needs You"
      icon={PenLine}
      iconColor="text-fuchsia-500"
      count={total}
    >
      <div className="space-y-4">
        {reviews.length > 0 && (
          <QueueGroup label="Articles awaiting review">
            {reviews.map((a) => (
              <QueueRow key={a.id} href={`/troubador/runs/${a.run_id}`}>
                {a.title}
                {a.run_title ? (
                  <span className="text-text-sub"> · {a.run_title}</span>
                ) : null}
              </QueueRow>
            ))}
          </QueueGroup>
        )}
        {planning.length > 0 && (
          <QueueGroup label="Runs to brief (Planning)">
            {planning.map((r) => (
              <QueueRow key={r.id} href={`/troubador/runs/${r.id}`}>
                {r.title}
              </QueueRow>
            ))}
          </QueueGroup>
        )}
        {topicSelection.length > 0 && (
          <QueueGroup label="Runs awaiting topic selection">
            {topicSelection.map((r) => (
              <QueueRow key={r.id} href={`/troubador/runs/${r.id}`}>
                {r.title}
              </QueueRow>
            ))}
          </QueueGroup>
        )}
        {interview.length > 0 && (
          <QueueGroup label="Runs ready for interview">
            {interview.map((r) => (
              <QueueRow key={r.id} href={`/troubador/runs/${r.id}`}>
                {r.title}
              </QueueRow>
            ))}
          </QueueGroup>
        )}
      </div>
    </DashboardSection>
  );
}

function QueueGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-text-sub mb-1">
        {label}
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function QueueRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-md px-2 py-1 text-sm text-text-main hover:bg-surface-alt"
      >
        {children}
      </Link>
    </li>
  );
}
