// Clarity Phase 5 — The Soothsayer's snooze action. Pure, dependency-free helpers (no
// React, no Prisma) so the wake-date math and the "is this arc currently snoozed" check are
// unit-testable without a DB or a rendered component — same discipline as arc-status.ts and
// today-picks.ts.

export type SnoozeQuickOption = '1d' | '3d' | 'next_week';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves a quick snooze option (or an explicit ISO date string for "pick date") to the
 * actual snoozed_until instant, anchored to `nowMs`. "next_week" wakes at the start of the
 * following Monday (00:00 UTC-anchored on the calendar date — the arc is a day-granularity
 * concept, same as TodayPick.date, so this deliberately does not chase per-user timezone
 * the way the time-shape does).
 */
export function computeSnoozeUntil(
  option: SnoozeQuickOption | { customDate: string },
  nowMs: number = Date.now()
): Date {
  if (typeof option === 'object') {
    return new Date(option.customDate);
  }

  const now = new Date(nowMs);
  if (option === '1d') return new Date(nowMs + DAY_MS);
  if (option === '3d') return new Date(nowMs + 3 * DAY_MS);

  // next_week: the coming Monday. getUTCDay(): 0=Sun..6=Sat.
  const day = now.getUTCDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday)
  );
  return target;
}

/** True while `snoozedUntil` is set and still in the future relative to `nowMs` — a
 *  snoozed arc hidden from Today's "no day assigned" guarantee and the Soothsayer's
 *  unplanned section until this passes. */
export function isArcSnoozed(snoozedUntil: Date | string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!snoozedUntil) return false;
  const t = typeof snoozedUntil === 'string' ? new Date(snoozedUntil).getTime() : snoozedUntil.getTime();
  if (Number.isNaN(t)) return false;
  return t > nowMs;
}
