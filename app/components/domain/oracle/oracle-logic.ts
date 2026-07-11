// Pure helpers for the Oracle fleet visualizer: status→theme-variable lookup,
// waiting-strip sort, source/status grouping, and elapsed/token formatting.
// Kept dependency-free (no React, no fetch) so they're trivially unit-testable and
// reusable across FleetTopbar, SessionCard, AgentRow, WaitingStrip.
import type {
  OracleCommandDTO,
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
  | 'idle'
  | 'needs_attention'
  | 'working'
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
  // Phase 4: alive but neither working nor flagging for Reshi — a real distinct
  // status (not a derived read-time state like `working`), muted like stale/queued
  // but never pulsing (it isn't dead, it just isn't doing anything right now).
  idle: { label: 'Idle', colorVar: '--text-muted', pulse: false, ring: false },
  needs_attention: { label: 'Needs attention', colorVar: '--warning', pulse: false, ring: true },
  // Phase 2: an orchestrator that ended its own turn (Stop -> waiting, or a stray
  // Notification -> needs_attention) while its own dispatched subagents are still
  // running isn't waiting on Reshi — it's waiting on its own kids. This is a
  // read-time DERIVED display state (never persisted, no new DB enum value) that
  // wins over needs_attention: accent (not warning gold) so it never reads as
  // "needs you". See isWorkingSession/hasRunningChild below.
  working: { label: 'Working', colorVar: '--accent', pulse: true, ring: false },
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
 * normally wins — it's the highest-priority signal regardless of underlying status)
 * to display metadata. Unknown statuses fall back to a muted "unknown" pill rather
 * than throwing, since agent status is a free string server-side.
 *
 * `working` outranks even needs_attention: it means the caller has already
 * determined (via isWorkingSession/hasRunningChild) that this session's
 * waiting/needs_attention read is actually "waiting on its own subagents", not on
 * Reshi — so the accent "Working" state must win over the warning-gold
 * needs_attention state, never the other way around.
 */
export function getStatusMeta(
  status: string | null | undefined,
  needsAttention = false,
  working = false
): StatusMeta {
  if (working) {
    return { kind: 'working', ...STATUS_META.working };
  }
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

/**
 * True when a session has at least one child agent still actively running.
 * Client-side derivation only — OracleSessionDTO already carries `agents[]` with
 * per-agent status, so no server/DTO change is needed to know "is this orchestrator
 * still waiting on its own subagents, or truly idle."
 */
export function hasRunningChild(session: OracleSessionDTO): boolean {
  return session.agents.some((agent) => agent.status === 'running');
}

/** Count of currently-running child agents — feeds the "working · N agents" label. */
export function runningChildCount(session: OracleSessionDTO): number {
  return session.agents.filter((agent) => agent.status === 'running').length;
}

/**
 * A session that LOOKS like it's waiting on Reshi (status waiting, or flagged
 * needs_attention) but actually has a live running child is "working", not
 * "waiting on you" — it ended its own turn to await its own dispatched subagents.
 * Read-time only: self-corrects back to waiting once the children finish, no
 * persistence involved.
 */
export function isWorkingSession(session: OracleSessionDTO): boolean {
  return (session.status === 'waiting' || session.needs_attention) && hasRunningChild(session);
}

export function isWaitingSession(session: OracleSessionDTO): boolean {
  return (session.status === 'waiting' || session.needs_attention) && !hasRunningChild(session);
}

// ============================================
// Phase 4 — three live buckets (waiting / working / idle)
// ============================================
// Mike's ruling: every live session belongs to exactly ONE of these three ordered
// groups. Precedence (checked in this order, first match wins) is what keeps a
// session from double-listing: waiting-on-you beats working beats idle beats
// ended/stale. isWaitingSession (above) is unchanged and stays the waiting-on-you
// definition. The two functions below are the bucket-membership versions of
// "working" and "idle" — distinct from isWorkingSession, which drives the
// **badge/border** read on an individual card (narrower: only the "waiting-on-its-
// own-kids" orchestrator case) and is left alone so that display language doesn't
// shift underneath Phase 2/3 callers.

/**
 * Bucket membership for "Working": actively computing right now — either the
 * session's own status is `running`, or it has at least one live running child
 * (an orchestrator whose own turn ended but is still waiting on subagents it
 * dispatched). Broader than isWorkingSession, which only fires when the session's
 * *stored* status also reads waiting/needs_attention — here a plain `running`
 * session with a running child is working too (it already was, isWorkingSession
 * just never needed to say so because status=running already covered it visually).
 */
export function isWorkingBucketSession(session: OracleSessionDTO): boolean {
  return session.status === 'running' || hasRunningChild(session);
}

/**
 * Bucket membership for "Idle": alive (status `idle`) and neither flagging for
 * Reshi nor actively computing. Precedence is explicit here (not just "not in the
 * other two groups") so this function is correct standalone, not only when called
 * after the other two have already filtered a list.
 */
export function isIdleSession(session: OracleSessionDTO): boolean {
  if (isWaitingSession(session)) return false;
  if (isWorkingBucketSession(session)) return false;
  return session.status === 'idle';
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
  working: OracleSessionWithMachine[];
  idle: OracleSessionWithMachine[];
  crons: OracleSessionWithMachine[];
  recentlyEnded: OracleSessionWithMachine[];
}

/**
 * Everything NOT in the waiting strip, bucketed for the mobile stack order
 * (Working, then Idle, then collapsed Crons / Recently ended) and reused verbatim
 * on desktop. Crons keep their own source-based group regardless of live state (a
 * running cron still reads as a Cron, not Working) — that's the one place source
 * still wins over status. Phase 4 removed the standalone Workflows group: Workflow-
 * tool workers now nest under the session that launched them (Lane A), so there are
 * no more top-level `source: 'workflow'` sessions to special-case here; any that
 * still show up (e.g. mid-run before the nesting lands) simply flow through the
 * same working/idle/recentlyEnded buckets as any other session.
 */
export function groupNonWaitingSessions(machines: OracleMachineDTO[]): SessionGroups {
  const groups: SessionGroups = { working: [], idle: [], crons: [], recentlyEnded: [] };
  for (const session of flattenSessions(machines)) {
    if (isWaitingSession(session)) continue;
    if (session.source === 'openclaw_cron') {
      groups.crons.push(session);
      continue;
    }
    if (isWorkingBucketSession(session)) {
      groups.working.push(session);
      continue;
    }
    if (isIdleSession(session)) {
      groups.idle.push(session);
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

// A working orchestrator (waiting on its own subagents) counts as "running" for the
// topbar pulse — it's genuinely active — and is excluded from "needs attention" so
// its stored needs_attention flag can't make the fleet dot read as needing Reshi.
export function anySessionRunning(machines: OracleMachineDTO[]): boolean {
  return machines.some((m) => m.sessions.some((s) => s.status === 'running' || isWorkingSession(s)));
}

export function anySessionNeedsAttention(machines: OracleMachineDTO[]): boolean {
  return machines.some((m) => m.sessions.some((s) => s.needs_attention && !hasRunningChild(s)));
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

// `approx`: claude_code token counts come from the heartbeat sampling a 200KB
// transcript-tail (an approximation, never a precise cumulative count — see the
// tokens_total monotonicity fix in the ingest route). Callers pass
// `session.source === 'claude_code'` so those numbers read with a "≈" prefix;
// workflow/cron numbers are exact (wf.totalTokens is cumulative truth) and stay
// unprefixed.
export function formatTokens(tokens: number | null | undefined, approx = false): string {
  const prefix = approx ? '≈' : '';
  return `${prefix}${(tokens ?? 0).toLocaleString()} tok`;
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

// ============================================
// Phase 1.5b — Remote Spawn commands
// ============================================
// Command chips get their own status→variant table rather than reusing
// getStatusMeta: the command lifecycle (pending/claimed/done/failed) is a
// different state machine from session/agent status (running/waiting/…), and per
// Mike's ruling pending pulses muted (distinct from `queued`'s static muted dot)
// while claimed reads as the active/in-progress state (accent, no pulse — the
// dispatcher owns the work now, nothing on this screen is "live" about it).

export interface CommandStatusMeta {
  label: string;
  /** CSS custom property name (e.g. "--accent") carrying this status's color. */
  colorVar: string;
  pulse: boolean;
}

const COMMAND_STATUS_META: Record<OracleCommandDTO['status'], CommandStatusMeta> = {
  pending: { label: 'Pending', colorVar: '--text-muted', pulse: true },
  claimed: { label: 'Claimed', colorVar: '--accent', pulse: false },
  done: { label: 'Done', colorVar: '--success', pulse: false },
  failed: { label: 'Failed', colorVar: '--error', pulse: false },
};

/** Falls back to a muted "unknown" pill rather than throwing — status is a DB enum
 *  server-side today, but this keeps the UI inert against a future added value. */
export function getCommandStatusMeta(status: string): CommandStatusMeta {
  return (
    COMMAND_STATUS_META[status as OracleCommandDTO['status']] ?? {
      label: status || 'Unknown',
      colorVar: '--text-muted',
      pulse: false,
    }
  );
}

/** Best-available display title for a command chip: explicit title, else cwd
 *  basename, else a short id — same fallback ladder as sessionDisplayTitle. */
export function commandDisplayTitle(command: OracleCommandDTO): string {
  if (command.title) return command.title;
  if (command.cwd) {
    const parts = command.cwd.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return command.id.slice(0, 8);
}

/** Client-computed relative age (no per-second refetch — same nowMs discipline as
 *  elapsedSince/formatElapsed elsewhere in this file). */
export function commandAge(createdAt: string, nowMs: number): string {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return '';
  const ms = Math.max(0, nowMs - t);
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return 'just now';
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export type RemoteControlDisplay = 'confirmed' | 'unconfirmed' | null;

/**
 * ADDENDUM (remote-control confirmation display): only meaningful once a spawn
 * command is `done` — a pending/claimed/failed command has no session to confirm
 * remote control on yet. Per Mike's ruling, `unconfirmed` renders as a WARNING, not
 * a success — the dispatcher couldn't verify remote control registered, so the
 * phone-attach path may not work even though the session itself spawned fine.
 * Missing/malformed `result.remote_control` on a done command is treated the same
 * as `unconfirmed` (fail toward the more visible warning state, never silently
 * green).
 */
export function commandRemoteControlState(command: OracleCommandDTO): RemoteControlDisplay {
  if (command.status !== 'done') return null;
  const rc = command.result?.remote_control;
  return rc === 'confirmed' ? 'confirmed' : 'unconfirmed';
}

/** Distinct, sorted cwd values across every session on the fleet — feeds the New
 *  Session modal's cwd <datalist> so a repeat spawn is a couple of keystrokes. */
export function distinctSessionCwds(machines: OracleMachineDTO[]): string[] {
  const cwds = new Set<string>();
  for (const machine of machines) {
    for (const session of machine.sessions) {
      if (session.cwd) cwds.add(session.cwd);
    }
  }
  return Array.from(cwds).sort();
}
