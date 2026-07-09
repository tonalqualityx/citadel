// Pure helpers for the Oracle fleet visualizer: status→theme-variable lookup,
// waiting-strip sort, source/status grouping, and elapsed/token formatting.
// Kept dependency-free (no React, no fetch) so they're trivially unit-testable and
// reusable across FleetTopbar, SessionCard, AgentRow, WaitingStrip.
import type {
  OracleMachineDTO,
  OracleSessionDTO,
  OracleSessionWithMachine,
} from '@/lib/types/oracle';

// ============================================
// Status → theme variable lookup
// ============================================
// House rule: warning is never red. running=accent(pulse), waiting=warning,
// needs_attention=warning+ring, done/ended=success, failed=error, stale/queued=muted.
// Colors are CSS variable NAMES, never hex — callers read them via `var(...)`.

export type OracleStatusKind =
  | 'running'
  | 'waiting'
  | 'needs_attention'
  | 'done'
  | 'failed'
  | 'stale'
  | 'queued'
  | 'unknown';

export interface StatusMeta {
  kind: OracleStatusKind;
  label: string;
  /** CSS custom property name (e.g. "--accent") carrying this status's color. */
  colorVar: string;
  pulse: boolean;
  ring: boolean;
}

const STATUS_META: Record<Exclude<OracleStatusKind, 'unknown'>, Omit<StatusMeta, 'kind'>> = {
  running: { label: 'Running', colorVar: '--accent', pulse: true, ring: false },
  waiting: { label: 'Waiting', colorVar: '--warning', pulse: false, ring: false },
  needs_attention: { label: 'Needs attention', colorVar: '--warning', pulse: false, ring: true },
  done: { label: 'Done', colorVar: '--success', pulse: false, ring: false },
  failed: { label: 'Failed', colorVar: '--error', pulse: false, ring: false },
  stale: { label: 'Stale', colorVar: '--text-muted', pulse: false, ring: false },
  queued: { label: 'Queued', colorVar: '--text-muted', pulse: false, ring: false },
};

// 'ended' (session) and 'done' (agent) are the same visual state.
const STATUS_ALIASES: Record<string, Exclude<OracleStatusKind, 'unknown'>> = {
  ended: 'done',
};

/**
 * Resolve a session or agent status string (plus the needs_attention flag, which
 * always wins — it's the highest-priority signal regardless of underlying status)
 * to display metadata. Unknown statuses fall back to a muted "unknown" pill rather
 * than throwing, since agent status is a free string server-side.
 */
export function getStatusMeta(
  status: string | null | undefined,
  needsAttention = false
): StatusMeta {
  if (needsAttention) {
    return { kind: 'needs_attention', ...STATUS_META.needs_attention };
  }
  const key = (status ?? '').toLowerCase();
  const resolvedKey = (STATUS_ALIASES[key] ?? key) as Exclude<OracleStatusKind, 'unknown'>;
  const meta = STATUS_META[resolvedKey];
  if (meta) return { kind: resolvedKey, ...meta };
  return {
    kind: 'unknown',
    label: status ? status : 'Unknown',
    colorVar: '--text-muted',
    pulse: false,
    ring: false,
  };
}

// ============================================
// Flatten / waiting-strip selection / grouping
// ============================================

export function flattenSessions(machines: OracleMachineDTO[]): OracleSessionWithMachine[] {
  return machines.flatMap((machine) =>
    machine.sessions.map((session) => ({ ...session, machine }))
  );
}

export function isWaitingSession(session: OracleSessionDTO): boolean {
  return session.status === 'waiting' || session.needs_attention;
}

/** Milliseconds since the session last made progress — the basis for wait-time sort. */
export function waitSinceMs(session: OracleSessionDTO, nowMs: number): number {
  const ref = session.last_event_at ?? session.started_at;
  if (!ref) return 0;
  const t = new Date(ref).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, nowMs - t);
}

/**
 * The pinned "Waiting on Reshi" section: sessions that are waiting OR flagged
 * needs_attention, across every machine, ordered by wait time DESC (longest wait
 * first) — this is THE priority element per Mike's ruling, especially on mobile.
 */
export function selectWaitingSessions(
  machines: OracleMachineDTO[],
  nowMs: number
): OracleSessionWithMachine[] {
  return flattenSessions(machines)
    .filter(isWaitingSession)
    .sort((a, b) => waitSinceMs(b, nowMs) - waitSinceMs(a, nowMs));
}

export interface SessionGroups {
  running: OracleSessionWithMachine[];
  workflows: OracleSessionWithMachine[];
  crons: OracleSessionWithMachine[];
  recentlyEnded: OracleSessionWithMachine[];
}

/**
 * Everything NOT in the waiting strip, bucketed for the mobile stack order
 * (Running, then collapsed Workflows / Crons / Recently ended) and reused verbatim
 * on desktop. Source-based groups (workflow/cron) win over status so a workflow
 * that finishes still reads as a Workflow, not "recently ended".
 */
export function groupNonWaitingSessions(machines: OracleMachineDTO[]): SessionGroups {
  const groups: SessionGroups = { running: [], workflows: [], crons: [], recentlyEnded: [] };
  for (const session of flattenSessions(machines)) {
    if (isWaitingSession(session)) continue;
    if (session.source === 'workflow') {
      groups.workflows.push(session);
      continue;
    }
    if (session.source === 'openclaw_cron') {
      groups.crons.push(session);
      continue;
    }
    if (session.status === 'running') {
      groups.running.push(session);
      continue;
    }
    groups.recentlyEnded.push(session);
  }
  return groups;
}

// ============================================
// Text filter (toolbar) — matches session AND its agents
// ============================================

export function sessionMatchesFilter(session: OracleSessionDTO, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;

  const sessionFields = [
    session.title,
    session.cwd,
    session.model,
    session.external_id,
    session.source,
    session.attention_reason,
  ];
  if (sessionFields.some((f) => f && String(f).toLowerCase().includes(q))) return true;

  return session.agents.some((agent) => {
    const agentFields = [agent.label, agent.phase, agent.activity, agent.model, agent.status];
    return agentFields.some((f) => f && String(f).toLowerCase().includes(q));
  });
}

/**
 * Applies the toolbar text filter across every machine's sessions, dropping
 * machines left with zero matching sessions. A blank filter is a no-op passthrough.
 */
export function filterMachines(
  machines: OracleMachineDTO[],
  filterText: string
): OracleMachineDTO[] {
  if (!filterText.trim()) return machines;
  return machines
    .map((machine) => ({
      ...machine,
      sessions: machine.sessions.filter((session) => sessionMatchesFilter(session, filterText)),
    }))
    .filter((machine) => machine.sessions.length > 0);
}

export function fleetCounts(machines: OracleMachineDTO[]): { sessions: number; agents: number } {
  let sessions = 0;
  let agents = 0;
  for (const machine of machines) {
    sessions += machine.sessions.length;
    for (const session of machine.sessions) agents += session.agents.length;
  }
  return { sessions, agents };
}

export function anySessionRunning(machines: OracleMachineDTO[]): boolean {
  return machines.some((m) => m.sessions.some((s) => s.status === 'running'));
}

export function anySessionNeedsAttention(machines: OracleMachineDTO[]): boolean {
  return machines.some((m) => m.sessions.some((s) => s.needs_attention));
}

// ============================================
// Formatting
// ============================================

/** "H:MM:SS" once past an hour, else "M:SS" — matches the Ringside reference. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTokens(tokens: number | null | undefined): string {
  return `${(tokens ?? 0).toLocaleString()} tok`;
}

/** Client-computed elapsed (no per-second refetch) between started_at and now/ended_at. */
export function elapsedSince(
  startedAt: string | null | undefined,
  nowMs: number,
  endedAt?: string | null
): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = endedAt ? new Date(endedAt).getTime() : nowMs;
  return Math.max(0, end - start);
}

export function formatClock(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatHeartbeatTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const SOURCE_LABELS: Record<string, string> = {
  claude_code: 'claude code',
  workflow: 'workflow',
  openclaw_cron: 'cron',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Best-available display title: harness title, else cwd basename, else short id. */
export function sessionDisplayTitle(session: OracleSessionDTO): string {
  if (session.title) return session.title;
  if (session.cwd) {
    const parts = session.cwd.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return session.external_id.slice(0, 12);
}
