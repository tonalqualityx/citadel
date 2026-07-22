'use client';

import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/hooks/use-now';
import { StatusDot } from './StatusDot';
import { OracleStatusBadge } from './OracleStatusBadge';
import { commandAge } from './oracle-logic';
import type { ArcSessionSummary } from '@/lib/hooks/use-arcs';

interface ArcSessionPanelProps {
  sessions: ArcSessionSummary[];
}

// Clarity Phase 4c — the arc board header's session panel: the arc's linked session(s),
// from Arc.origin_session_external_id AND any OracleSession rows with arc_id = this arc
// (merged server-side — see lib/arc-sessions.ts). Exception display per the spec: no
// sessions linked -> renders nothing, not an empty-state card.
export function ArcSessionPanel({ sessions }: ArcSessionPanelProps) {
  const nowMs = useNow(30_000);

  if (sessions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="arc-session-panel">
      {sessions.map((session) => (
        <ArcSessionRow key={session.id} session={session} nowMs={nowMs} />
      ))}
    </div>
  );
}

function ArcSessionRow({ session, nowMs }: { session: ArcSessionSummary; nowMs: number }) {
  const isLive = session.status === 'running' || session.status === 'waiting' || session.status === 'idle';
  const showRespond = isLive && !!session.remote_url;
  const waitingSinceLabel =
    session.needs_attention && session.last_event_at ? commandAge(session.last_event_at, nowMs) : null;

  return (
    <Card
      className="flex flex-wrap items-center gap-2 p-2.5"
      data-testid="arc-session-row"
      data-session-status={session.status}
    >
      <StatusDot status={session.status} needsAttention={session.needs_attention} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-main">
        {session.title || session.external_id.slice(0, 12)}
      </span>
      <OracleStatusBadge status={session.status} needsAttention={session.needs_attention} />
      {showRespond && (
        <Button asChild variant="secondary" size="sm" className="shrink-0">
          <a href={session.remote_url as string} target="_blank" rel="noopener noreferrer" data-testid="arc-session-respond">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Respond
          </a>
        </Button>
      )}
      {waitingSinceLabel && (
        <span className="w-full text-xs text-text-sub" data-testid="arc-session-waiting-since">
          waiting since {waitingSinceLabel}
        </span>
      )}
    </Card>
  );
}
