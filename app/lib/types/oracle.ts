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
  status: OracleSessionStatus;
  needs_attention: boolean;
  attention_reason: string | null;
  started_at: string | null;
  last_event_at: string | null;
  ended_at: string | null;
  tokens_total: number;
  agents: OracleAgentDTO[];
}

export interface OracleMachineDTO {
  id: string;
  name: string;
  hostname: string | null;
  last_heartbeat_at: string | null;
  stale: boolean;
  sessions: OracleSessionDTO[];
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
