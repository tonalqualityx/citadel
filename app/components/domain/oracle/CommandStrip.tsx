'use client';

import { cn } from '@/lib/utils/cn';
import type { OracleCommandDTO } from '@/lib/types/oracle';
import {
  commandAge,
  commandDisplayTitle,
  commandRemoteControlState,
  getCommandStatusMeta,
} from './oracle-logic';

interface CommandChipProps {
  command: OracleCommandDTO;
  nowMs: number;
}

function CommandChip({ command, nowMs }: CommandChipProps) {
  const meta = getCommandStatusMeta(command.status);
  const color = `var(${meta.colorVar})`;
  const remoteControl = commandRemoteControlState(command);

  return (
    <div
      className="ui-monospace flex min-h-11 min-w-0 items-center gap-1.5 rounded-md border bg-background-light/40 px-2 py-1 text-[0.7rem]"
      style={{ borderLeftColor: color, borderLeftWidth: '3px', borderColor: 'var(--border-warm)' }}
      data-testid="command-chip"
      data-status={command.status}
    >
      <span
        aria-hidden="true"
        className={cn('inline-block h-2 w-2 shrink-0 rounded-full', meta.pulse && 'animate-pulse')}
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 truncate font-bold text-text-main" title={command.cwd ?? undefined}>
        {commandDisplayTitle(command)}
      </span>
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase"
        style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
      >
        {meta.label}
      </span>
      {remoteControl === 'confirmed' && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold"
          style={{
            color: 'var(--success)',
            backgroundColor: 'color-mix(in srgb, var(--success) 16%, transparent)',
          }}
        >
          remote ✓
        </span>
      )}
      {remoteControl === 'unconfirmed' && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold"
          style={{
            color: 'var(--warning)',
            backgroundColor: 'color-mix(in srgb, var(--warning) 16%, transparent)',
          }}
        >
          remote unconfirmed
        </span>
      )}
      {command.status === 'failed' && command.error && (
        <span
          className="min-w-0 truncate text-[color:var(--error)]"
          title={command.error}
        >
          {command.error}
        </span>
      )}
      <span className="ml-auto shrink-0 text-text-sub">{commandAge(command.created_at, nowMs)}</span>
    </div>
  );
}

interface CommandStripProps {
  commands: OracleCommandDTO[];
  nowMs: number;
}

// Per-machine remote-spawn command history (last 24h, capped 20, newest first from
// the API). Empty array renders nothing — no empty chrome for a feature most
// machines will never touch. Wraps rather than horizontally scrolling so it never
// contributes to page-level overflow at 360px.
export function CommandStrip({ commands, nowMs }: CommandStripProps) {
  if (commands.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="command-strip">
      {commands.map((command) => (
        <CommandChip key={command.id} command={command} nowMs={nowMs} />
      ))}
    </div>
  );
}
