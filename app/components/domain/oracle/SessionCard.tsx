'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Card } from '@/components/ui/card';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { StatusDot } from './StatusDot';
import { OracleStatusBadge } from './OracleStatusBadge';
import { AgentRow } from './AgentRow';
import { EventDrawer } from './EventDrawer';
import {
  elapsedSince,
  formatElapsed,
  formatTokens,
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

  return (
    <Card
      className={cn(
        'overflow-hidden py-0 shadow-none',
        session.needs_attention && 'border-[color:var(--warning)]',
        className
      )}
      data-testid="session-card"
      data-status={session.status}
    >
      <button
        type="button"
        onClick={() => setOpenKey((k) => (k === 'session' ? null : 'session'))}
        className="flex min-h-11 w-full min-w-0 flex-col gap-1 border-b border-border-warm px-3 py-2 text-left hover:bg-background-light/50"
        aria-expanded={openKey === 'session'}
      >
        {/* Row 1: dot + title + status — the title gets the full card width so it
            doesn't collapse to a couple of characters at 360-390px (Ringside's
            single-line header works at desktop width; this two-row split is the
            deliberate mobile-legibility deviation — see spec deviations in the
            hand-off report). */}
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={session.status} needsAttention={session.needs_attention} />
          <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-text-main">
            {sessionDisplayTitle(session)}
          </span>
          <OracleStatusBadge
            status={session.status}
            needsAttention={session.needs_attention}
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
          <span className="shrink-0">{formatTokens(session.tokens_total)}</span>
        </div>
      </button>

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
