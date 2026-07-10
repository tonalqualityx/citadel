'use client';

import { cn } from '@/lib/utils/cn';
import type { OracleAgentDTO } from '@/lib/types/oracle';
import { getStatusMeta, formatElapsed, formatTokens } from './oracle-logic';

interface AgentRowProps {
  agent: OracleAgentDTO;
  nowMs: number;
  selected: boolean;
  onToggle: () => void;
}

// Ringside task card: left border in status color, key + status pill, activity
// line, elapsed + tokens meta. Tap toggles this agent's EventDrawer inline (parent
// owns which key is open so only one drawer per session is expanded at a time).
export function AgentRow({ agent, nowMs, selected, onToggle }: AgentRowProps) {
  const meta = getStatusMeta(agent.status);
  const color = `var(${meta.colorVar})`;

  const elapsedMs =
    agent.duration_ms != null
      ? agent.duration_ms
      : agent.started_at
        ? nowMs - new Date(agent.started_at).getTime()
        : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={selected}
      data-agent-row
      className={cn(
        'flex min-h-11 min-w-0 flex-col gap-1 rounded-md border bg-background-light/40 p-2 text-left transition-colors',
        selected ? 'border-border-warm bg-background-light/70' : 'border-border-warm/60 hover:bg-background-light/60'
      )}
      style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-bold text-text-main">{agent.label}</span>
        <span
          className="ui-monospace shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase"
          style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          {meta.label}
        </span>
      </div>
      {agent.activity && (
        <div className="ui-monospace truncate text-[0.65rem] text-text-sub" title={agent.activity}>
          &gt; {agent.activity}
        </div>
      )}
      <div className="ui-monospace flex items-center gap-2 text-[0.65rem] text-text-sub">
        <span>{elapsedMs != null ? formatElapsed(elapsedMs) : '—'}</span>
        <span aria-hidden="true">·</span>
        <span>{formatTokens(agent.tokens)}</span>
        {agent.phase && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{agent.phase}</span>
          </>
        )}
      </div>
    </button>
  );
}
