/**
 * Fleet item 6: record a lane-scoped key calling outside its lane. Fire-and-forget (a failed
 * write never fails the request) and throttled to one row per key, method and path per minute
 * in this process, so a looping reader cannot flood the table.
 */
import { prisma } from '@/lib/db/prisma';

export const VIOLATION_THROTTLE_MS = 60_000;
const MAX_TRACKED = 5_000;
const lastWritten = new Map<string, number>();

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
  // Still too many distinct recent paths: drop the oldest entries (Map keeps insertion order).
  while (lastWritten.size > MAX_TRACKED) {
    const first = lastWritten.keys().next();
    if (first.done) break;
    lastWritten.delete(first.value);
  }
}

/** Returns true when a row was queued, false when throttled. Never throws. */
export function recordKeyViolation(v: ViolationInput, now: number = Date.now()): boolean {
  const key = `${v.apiKeyId} ${v.method} ${v.path}`;
  const prev = lastWritten.get(key);
  if (prev !== undefined && now - prev < VIOLATION_THROTTLE_MS) return false;
  lastWritten.delete(key);
  lastWritten.set(key, now);
  if (lastWritten.size > MAX_TRACKED) prune(now);
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
  return true;
}

/** Test helper: forget the throttle window. */
export function resetKeyViolationThrottle() {
  lastWritten.clear();
}
