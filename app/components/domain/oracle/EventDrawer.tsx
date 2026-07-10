'use client';

import type * as React from 'react';
import type { OracleAgentDTO, OracleSessionDTO } from '@/lib/types/oracle';
import { formatElapsed, formatTokens, sourceLabel } from './oracle-logic';

interface MetaLineProps {
  label: string;
  value: React.ReactNode;
}

function MetaLine({ label, value }: MetaLineProps) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex min-w-0 gap-1.5 text-[0.7rem]">
      <span className="ui-monospace shrink-0 font-bold uppercase tracking-wide text-text-sub">
        {label}
      </span>
      <span className="ui-monospace min-w-0 truncate text-text-main" title={String(value)}>
        {value}
      </span>
    </div>
  );
}

interface EventDrawerProps {
  session: OracleSessionDTO;
  /** When set, the drawer is scoped to this one agent instead of the whole session. */
  agent?: OracleAgentDTO;
  nowMs: number;
}

// The fleet response carries no OracleEvent rows (Phase 1 keeps the drawer
// cheap — no extra endpoint). This renders from session/agent fields we already
// have: full timestamps, cwd/model/external_id, attention reason, and — for an
// agent-scoped drawer — that agent's phase/duration/activity in full.
export function EventDrawer({ session, agent, nowMs }: EventDrawerProps) {
  if (agent) {
    return (
      <div
        className="ui-monospace flex flex-col gap-1.5 border-t border-border-warm bg-background-light/60 p-2.5 text-text-sub"
        data-testid="event-drawer-agent"
      >
        <MetaLine label="agent" value={agent.external_id} />
        <MetaLine label="phase" value={agent.phase} />
        <MetaLine label="model" value={agent.model} />
        <MetaLine label="activity" value={agent.activity} />
        <MetaLine
          label="duration"
          value={
            agent.duration_ms != null
              ? formatElapsed(agent.duration_ms)
              : agent.started_at
                ? `${formatElapsed(nowMs - new Date(agent.started_at).getTime())} (running)`
                : null
          }
        />
        <MetaLine label="tokens" value={formatTokens(agent.tokens)} />
        <MetaLine
          label="started"
          value={agent.started_at ? new Date(agent.started_at).toLocaleString() : null}
        />
        <MetaLine
          label="ended"
          value={agent.ended_at ? new Date(agent.ended_at).toLocaleString() : null}
        />
        <div className="mt-1 border-t border-border-warm/60 pt-1.5 text-[0.65rem] opacity-80">
          part of session: {session.title ?? session.external_id}
        </div>
      </div>
    );
  }

  return (
    <div
      className="ui-monospace flex flex-col gap-1.5 border-t border-border-warm bg-background-light/60 p-2.5 text-text-sub"
      data-testid="event-drawer-session"
    >
      <MetaLine label="session" value={session.external_id} />
      <MetaLine label="source" value={sourceLabel(session.source)} />
      <MetaLine label="cwd" value={session.cwd} />
      <MetaLine label="model" value={session.model} />
      {session.attention_reason && (
        <div className="rounded border px-2 py-1 text-[0.7rem]" style={{
          borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--warning) 12%, transparent)',
          color: 'var(--warning)',
        }}>
          {session.attention_reason}
        </div>
      )}
      <MetaLine
        label="started"
        value={session.started_at ? new Date(session.started_at).toLocaleString() : null}
      />
      <MetaLine
        label="last event"
        value={session.last_event_at ? new Date(session.last_event_at).toLocaleString() : null}
      />
      <MetaLine
        label="ended"
        value={session.ended_at ? new Date(session.ended_at).toLocaleString() : null}
      />
      <MetaLine
        label="tokens"
        value={formatTokens(session.tokens_total, session.source === 'claude_code')}
      />
      {session.agents.length === 0 && (
        <div className="mt-1 border-t border-border-warm/60 pt-1.5 text-[0.65rem] opacity-80">
          no sub-agents reported for this session
        </div>
      )}
    </div>
  );
}
