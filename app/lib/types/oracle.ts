// Oracle Phase 1 fleet telemetry — types for GET /api/oracle/fleet.
// Read-only visualizer over Claude Code sessions, Workflow fan-outs, and openclaw
// crons. Mirrors app/api/oracle/fleet/route.ts response shape exactly — keep in sync
// if the backend contract changes (it is gated/committed separately from this UI work).

export type OracleSource = 'claude_code' | 'workflow' | 'openclaw_cron';

export type OracleSessionStatus = 'running' | 'waiting' | 'ended' | 'stale';

// Agent status is a free string server-side (new phase labels never require a
// migration) but the fixture/heartbeat set is: running | done | failed | queued.
export type OracleAgentStatus = 'running' | 'done' | 'failed' | 'queued' | string;

export interface OracleAgentDTO {
  id: string;
  external_id: string;
  label: string;
  phase: string | null;
  model: string | null;
  status: OracleAgentStatus;
  activity: string | null;
  tokens: number;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface OracleSessionDTO {
  id: string;
  external_id: string;
  source: OracleSource;
  title: string | null;
  cwd: string | null;
  model: string | null;
  // Claude Remote Control deep-link (Oracle Phase 3), e.g. https://claude.ai/code/session_xxx.
  // Set by the heartbeat only when a bridge session exists; null when absent/not (yet)
  // remote-control-enabled. Validated server-side (host === claude.ai, path starts /code/).
  remote_url: string | null;
  status: OracleSessionStatus;
  needs_attention: boolean;
  attention_reason: string | null;
  started_at: string | null;
  last_event_at: string | null;
  ended_at: string | null;
  tokens_total: number;
  agents: OracleAgentDTO[];
}

// Phase 1.5b — Remote Spawn. Mirrors app/api/oracle/fleet/route.ts's `commands` shape
// (each machine's last 24h of spawn_session commands, newest first, capped 20) and
// app/api/oracle/commands/route.ts's POST/GET response shapes. `result` is opaque
// server-side (Json?) but the dispatcher's contract (feature-planning
// oracle-phase1-visualizer.md ADDENDUM) is { tmux_session?, remote_control? } once a
// spawn completes — read defensively, both fields are optional even on `done`.
export type OracleCommandStatus = 'pending' | 'claimed' | 'done' | 'failed';

export type OracleCommandRemoteControl = 'confirmed' | 'unconfirmed';

export interface OracleCommandResult {
  tmux_session?: string;
  remote_control?: OracleCommandRemoteControl;
  [key: string]: unknown;
}

export interface OracleCommandDTO {
  id: string;
  verb: string;
  status: OracleCommandStatus;
  title: string | null;
  cwd: string | null;
  created_at: string;
  completed_at: string | null;
  result: OracleCommandResult | null;
  error: string | null;
}

export interface OracleMachineDTO {
  id: string;
  name: string;
  hostname: string | null;
  last_heartbeat_at: string | null;
  stale: boolean;
  sessions: OracleSessionDTO[];
  commands: OracleCommandDTO[];
}

// POST /api/oracle/commands request body — admin only, verb hard-allowlisted
// server-side via a Zod literal (this client-side type mirrors that, it is not the
// security boundary).
export interface CreateOracleCommandInput {
  machine: string;
  verb: 'spawn_session';
  payload: {
    cwd: string;
    prompt?: string;
    title?: string;
  };
}

export interface OracleFleetCounts {
  machines: number;
  sessions: number;
  agents: number;
}

export interface OracleFleetResponse {
  machines: OracleMachineDTO[];
  counts: OracleFleetCounts;
  generated_at: string;
}

// A session flattened with its parent machine — the shape most Oracle UI pieces
// actually want (WaitingStrip, grouping, filtering all work across machines).
export interface OracleSessionWithMachine extends OracleSessionDTO {
  machine: OracleMachineDTO;
}
