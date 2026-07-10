// Shared constants + helpers for the Oracle fleet-telemetry ingest pipeline.
import type { TokenPayload } from '@/lib/auth/jwt';

// The local heartbeat/hook client authenticates as this service user (seeded separately).
// Used to enforce "ingest is machine-only" — no human/browser session may POST telemetry.
export const ORACLE_SERVICE_EMAIL = 'oracle@indelible.bot';

export function isOracleBot(auth: { email?: string } | TokenPayload | null | undefined): boolean {
  return !!auth?.email && auth.email.toLowerCase() === ORACLE_SERVICE_EMAIL;
}

// Reconciliation window: a running/waiting session absent from the latest snapshot for
// longer than this is presumed dead and flipped to `stale` at ingest time.
export const RECONCILE_STALE_MINUTES = 5;

// Read-time (not write-time) staleness: if a machine's last heartbeat is older than this,
// the fleet view shows a "telemetry stale since HH:MM" banner for that machine.
export const HEARTBEAT_STALE_MINUTES = 3;

// Append-only OracleEvent rows older than this are opportunistically pruned during ingest.
export const EVENT_RETENTION_DAYS = 7;

// Hard caps enforced by the ingest Zod schema — protect against a runaway/misbehaving
// local client flooding the table or sending unbounded payloads.
export const MAX_EVENTS_PER_INGEST = 500;
export const MAX_PAYLOAD_BYTES = 32_000; // per event/snapshot-agent payload blob

export function isMachineStale(lastHeartbeatAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastHeartbeatAt) return true;
  return now.getTime() - new Date(lastHeartbeatAt).getTime() > HEARTBEAT_STALE_MINUTES * 60_000;
}

// Phase 1.5b — Remote Spawn command queue constants.
// Cap on the JSON-serialized size of a command's `result` blob (PATCH .../complete). This
// is machine-authored (the dispatcher reporting tmux_session/remote_control), not user
// input, but still capped defensively — same discipline as ingest's MAX_PAYLOAD_BYTES.
export const MAX_COMMAND_RESULT_BYTES = 8_000;

// Fleet response's `commands` field: only the last N hours, capped per machine, newest first.
export const COMMAND_RECENT_HOURS = 24;
export const COMMAND_RECENT_CAP = 20;

// Phase 2 read-time cleanup: a `stale` session whose last_event_at is older than this is
// long-dead (the client gave up reconciling it — see RECONCILE_STALE_MINUTES above, which
// only governs the running->stale transition, not how long a stale row lingers after).
// There is no delete/prune path for sessions, so instead of a destructive cleanup job the
// fleet route simply excludes long-stale rows from its response at read time — nothing is
// deleted, a stale row just ages out of view after an hour. Freshly-stale sessions (e.g. a
// machine reconciled dead moments ago) still show up so a real crash is still visible.
export const STALE_HIDE_MINUTES = 60;
