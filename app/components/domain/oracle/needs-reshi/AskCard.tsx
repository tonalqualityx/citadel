'use client';

import Link from 'next/link';
import { ExternalLink, Clock, Ban, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { AskCardData } from './needs-reshi-logic';

interface AskCardProps {
  data: AskCardData;
}

// Severity is always icon + words on a subtle field — color never carries meaning alone (a
// muted palette fails color-only tests by design, per the mockup's own note). Note: none of
// these use `--error`/red for severity styling on their own — warning-gold + neutral fields
// only, consistent with the Oracle-wide no-red rule.
const SEVERITY_META: Record<
  NonNullable<AskCardData['severity']>,
  { label: string; icon: typeof Clock; bg: string; fg: string }
> = {
  client_blocking: { label: 'client-blocking', icon: Ban, bg: 'var(--warning-subtle)', fg: 'var(--warning)' },
  launch_blocking: { label: 'launch-blocking', icon: Clock, bg: 'var(--warning-subtle)', fg: 'var(--warning)' },
  internal: { label: 'internal', icon: Info, bg: 'var(--background-light)', fg: 'var(--text-sub)' },
};

// A dumb presentational card — the source/manifest-vs-legacy adapting lives in
// needs-reshi-logic.ts, so this only ever renders a finished AskCardData. The ONLY visual
// distinction between a manifest-declared session ask and a legacy hook-flagged one is the
// source line ("session" vs "session · legacy") — nothing louder, per the binding
// correction.
export function AskCard({ data }: AskCardProps) {
  const severityMeta = data.severity ? SEVERITY_META[data.severity] : null;

  return (
    <Card className="flex flex-col gap-1.5 p-3" data-testid="ask-card" data-source-label={data.sourceLabel}>
      <div className="flex items-center gap-1.5 text-xs text-text-sub">
        <span>{data.sourceLabel}</span>
        {data.contextLabel && <span>· {data.contextLabel}</span>}
      </div>

      <p className="text-sm text-text-main">{data.bodyText}</p>

      {severityMeta && (
        <span
          className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: severityMeta.bg, color: severityMeta.fg }}
        >
          <severityMeta.icon className="h-3 w-3" aria-hidden="true" />
          {severityMeta.label}
        </span>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        {data.primaryAction.kind === 'open_review' && (
          <Button asChild variant="primary" size="sm">
            <Link href={`/tasks/${data.primaryAction.taskId}`}>Open review</Link>
          </Button>
        )}
        {data.primaryAction.kind === 'respond' && (
          <Button asChild variant="primary" size="sm">
            <a href={data.primaryAction.remoteUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Respond
            </a>
          </Button>
        )}
        {data.primaryAction.kind === 'none' && (
          <span className="text-xs text-text-sub">No live session to respond to</span>
        )}
      </div>
    </Card>
  );
}
