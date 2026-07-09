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
