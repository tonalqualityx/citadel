/**
 * Fleet item 6: record a lane-scoped key calling outside its lane. Fire-and-forget (a failed
 * write never fails the request). Limits, per process:
 *   - one row per key, method and path per minute (a looping reader writes one row, not thousands);
 *   - at most KEY_CAP_PER_MINUTE rows per key per minute in all (a key walking many paths);
 *   - retention: rows older than RETENTION_DAYS are deleted, at most once an hour, on this same path.
 */
import { prisma } from '@/lib/db/prisma';

export const VIOLATION_THROTTLE_MS = 60_000;
export const KEY_CAP_PER_MINUTE = 60;
export const RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60_000;
const MAX_TRACKED = 5_000;
const lastWritten = new Map<string, number>();
const perKey = new Map<string, { windowStart: number; count: number }>();
let lastPrune = 0;

export interface ViolationInput {
  apiKeyId: string;
  keyPrefix: string;
  lane: string;
  method: string;
  path: string;
  enforced: boolean;
}

function prune(now: number) {
  for (const [k, t] of lastWritten) {
    if (now - t >= VIOLATION_THROTTLE_MS) lastWritten.delete(k);
  }
  for (const [k, w] of perKey) {
    if (now - w.windowStart >= VIOLATION_THROTTLE_MS) perKey.delete(k);
  }
  // Still too many distinct recent paths: drop the oldest entries (Map keeps insertion order).
  while (lastWritten.size > MAX_TRACKED) {
    const first = lastWritten.keys().next();
    if (first.done) break;
    lastWritten.delete(first.value);
  }
}

function pruneOldRows(now: number) {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  try {
    prisma.apiKeyViolation
      .deleteMany({ where: { at: { lt: new Date(now - RETENTION_DAYS * 24 * 60 * 60_000) } } })
      .catch(() => {});
  } catch {
    // Never fails the request.
  }
}

/** Returns true when a row was queued, false when throttled or capped. Never throws. */
export function recordKeyViolation(v: ViolationInput, now: number = Date.now()): boolean {
  const key = `${v.apiKeyId} ${v.method} ${v.path}`;
  const prev = lastWritten.get(key);
  if (prev !== undefined && now - prev < VIOLATION_THROTTLE_MS) return false;

  const w = perKey.get(v.apiKeyId);
  if (w && now - w.windowStart < VIOLATION_THROTTLE_MS) {
    if (w.count >= KEY_CAP_PER_MINUTE) return false;
    w.count += 1;
  } else {
    perKey.set(v.apiKeyId, { windowStart: now, count: 1 });
  }

  lastWritten.delete(key);
  lastWritten.set(key, now);
  if (lastWritten.size > MAX_TRACKED || perKey.size > MAX_TRACKED) prune(now);
  try {
    prisma.apiKeyViolation
      .create({
        data: {
          api_key_id: v.apiKeyId,
          key_prefix: v.keyPrefix.slice(0, 20),
          lane: v.lane.slice(0, 40),
          method: v.method.slice(0, 10),
          path: v.path.slice(0, 300),
          enforced: v.enforced,
        },
      })
      .catch(() => {});
  } catch {
    // A synchronous failure (for example a missing client in a test) must not fail the request.
  }
  pruneOldRows(now);
  return true;
}

/** Test helper: forget the throttle windows and the prune clock. */
export function resetKeyViolationThrottle() {
  lastWritten.clear();
  perKey.clear();
  lastPrune = 0;
}
