'use client';

import Link from 'next/link';
import { ExternalLink, Clock, Ban, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { WaitingOnMeCard } from '@/lib/hooks/use-waiting-on-me';

interface AskCardProps {
  card: WaitingOnMeCard;
  remoteUrl?: string | null;
}

// Severity is always icon + words on a subtle field — color never carries meaning alone (a
// muted palette fails color-only tests by design, per the mockup's own note). Note: none of
// these use `--error`/red for severity styling on their own — warning-gold + neutral fields
// only, consistent with the Oracle-wide no-red rule.
const SEVERITY_META: Record<
  NonNullable<WaitingOnMeCard['severity']>,
  { label: string; icon: typeof Clock; bg: string; fg: string }
> = {
  client_blocking: { label: 'client-blocking', icon: Ban, bg: 'var(--warning-subtle)', fg: 'var(--warning)' },
  launch_blocking: { label: 'launch-blocking', icon: Clock, bg: 'var(--warning-subtle)', fg: 'var(--warning)' },
  internal: { label: 'internal', icon: Info, bg: 'var(--background-light)', fg: 'var(--text-sub)' },
};

export function AskCard({ card, remoteUrl }: AskCardProps) {
  const severityMeta = card.severity ? SEVERITY_META[card.severity] : null;

  return (
    <Card className="flex flex-col gap-1.5 p-3" data-testid="ask-card" data-card-type={card.type}>
      <div className="flex items-center gap-1.5 text-xs text-text-sub">
        <span>{card.type === 'session_ask' ? 'session' : 'quest'}</span>
        {card.arc && <span>· {card.arc.name}</span>}
      </div>

      <p className="text-sm text-text-main">{card.title ?? 'Untitled'}</p>

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
        {card.type === 'task' && card.task_id && (
          <Button asChild variant="primary" size="sm">
            <Link href={`/tasks/${card.task_id}`}>Open review</Link>
          </Button>
        )}
        {card.type === 'session_ask' &&
          (remoteUrl ? (
            <Button asChild variant="primary" size="sm">
              <a href={remoteUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Respond
              </a>
            </Button>
          ) : (
            <span className={cn('text-xs text-text-sub')}>No live session to respond to</span>
          ))}
      </div>
    </Card>
  );
}
