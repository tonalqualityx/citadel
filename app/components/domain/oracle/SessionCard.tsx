'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { StatusDot } from './StatusDot';
import { OracleStatusBadge } from './OracleStatusBadge';
import { AgentRow } from './AgentRow';
import { EventDrawer } from './EventDrawer';
import {
  elapsedSince,
  formatElapsed,
  formatTokens,
  isWorkingSession,
  runningChildCount,
  sessionDisplayTitle,
  sourceLabel,
} from './oracle-logic';

interface SessionCardProps {
  session: OracleSessionWithMachine;
  nowMs: number;
  /** Global collapse-all state from the toolbar — hides the agent grid entirely. */
  collapsed: boolean;
  className?: string;
}

// Ringside run card: header (dot, name, identity, elapsed, tokens) + task grid +
// click-to-open drawer. `openKey` is 'session' (card header clicked, or no agents to
// click) or an agent's external_id — only one drawer open per card at a time.
export function SessionCard({ session, nowMs, collapsed, className }: SessionCardProps) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  const elapsedMs = elapsedSince(session.started_at, nowMs, session.ended_at);
  const hasAgents = session.agents.length > 0;
  const openAgent = openKey ? session.agents.find((a) => a.external_id === openKey) : undefined;
  const drawerOpen = openKey === 'session' || !!openAgent;
  // Phase 2: this session reads as waiting/needs_attention on its stored status but
  // has a live running child — it's "working" (waiting on its own subagents, not
  // Reshi), so it gets the accent working presentation instead of the warning border.
  const working = isWorkingSession(session);
  const workingCount = working ? runningChildCount(session) : 0;
  // Phase 3: "Respond" only makes sense on a live session that actually has a
  // Remote Control bridge — ended/stale sessions get no dead link, and a session
  // without remote_url (older session, or remote control never enabled for it)
  // gets no button at all. `working` already folds in waiting/needs_attention
  // sessions that are really waiting on their own subagents (isWorkingSession).
  // Phase 4: `idle` (alive but doing nothing right now) is live too — it's still a
  // clickable session, just not busy — so it gets Respond same as running/waiting.
  const isLive =
    session.status === 'running' ||
    session.status === 'waiting' ||
    session.status === 'idle' ||
    working;
  const showRespond = Boolean(session.remote_url) && isLive;
  // Prominent (primary, full-size) on a waiting/working card — that's the point of
  // the button, Mike triaging from the couch. Secondary (smaller) on a plain
  // running card where it's a convenience, not the primary action.
  const respondProminent = working || session.status === 'waiting';

  return (
    <Card
      className={cn(
        'overflow-hidden py-0 shadow-none',
        working
          ? 'border-[color:var(--accent)]'
          : session.needs_attention && 'border-[color:var(--warning)]',
        className
      )}
      data-testid="session-card"
      data-status={session.status}
      data-working={working || undefined}
    >
      <div className="flex min-w-0 items-stretch gap-1 border-b border-border-warm">
        <button
          type="button"
          onClick={() => setOpenKey((k) => (k === 'session' ? null : 'session'))}
          className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 px-3 py-2 text-left hover:bg-background-light/50"
          aria-expanded={openKey === 'session'}
        >
          {/* Row 1: dot + title + status — the title gets the full card width so it
              doesn't collapse to a couple of characters at 360-390px (Ringside's
              single-line header works at desktop width; this two-row split is the
              deliberate mobile-legibility deviation — see spec deviations in the
              hand-off report). */}
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot status={session.status} needsAttention={session.needs_attention} working={working} />
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-text-main">
              {sessionDisplayTitle(session)}
            </span>
            <OracleStatusBadge
              status={session.status}
              needsAttention={session.needs_attention}
              working={working}
              workingCount={workingCount}
              className="shrink-0"
            />
          </div>
          {/* Row 2: identity (source · model) + elapsed + tokens */}
          <div className="ui-monospace flex min-w-0 items-center gap-2 pl-[1.125rem] text-[0.7rem] text-text-sub">
            <span className="min-w-0 flex-1 truncate">
              {sourceLabel(session.source)}
              {session.model ? ` · ${session.model}` : ''}
            </span>
            <span className="shrink-0">{formatElapsed(elapsedMs)}</span>
            <span className="shrink-0">
              {formatTokens(session.tokens_total, session.source === 'claude_code')}
            </span>
          </div>
        </button>

        {/* Respond deep-links out to Claude Remote Control (browser on desktop, the
            Claude app on phone) for this exact session. A sibling of the toggle
            button (never nested inside it — an <a> can't legally nest inside a
            <button>), so its own click never reaches the drawer toggle; the
            stopPropagation below is defense-in-depth against a future wrapping
            click handler. */}
        {showRespond && session.remote_url && (
          <div className="flex shrink-0 items-center py-2 pr-2">
            <Button
              asChild
              variant={respondProminent ? 'primary' : 'secondary'}
              size={respondProminent ? 'default' : 'sm'}
              className="min-h-11"
            >
              <a
                href={session.remote_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                data-testid="respond-link"
                aria-label={`Respond to ${sessionDisplayTitle(session)} in Claude Remote Control`}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Respond
              </a>
            </Button>
          </div>
        )}
      </div>

      {!collapsed && hasAgents && (
        <div className="grid grid-cols-1 gap-1.5 p-2 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {session.agents.map((agent) => (
            <AgentRow
              key={agent.external_id}
              agent={agent}
              nowMs={nowMs}
              selected={openKey === agent.external_id}
              onToggle={() =>
                setOpenKey((k) => (k === agent.external_id ? null : agent.external_id))
              }
            />
          ))}
        </div>
      )}

      {drawerOpen && (
        <EventDrawer session={session} agent={openAgent} nowMs={nowMs} />
      )}
    </Card>
  );
}
