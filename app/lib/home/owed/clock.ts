/**
 * Slice 4c: the owed-reply and lead clocks, and the wake rule. Pure: timestamps in, facts out. Nothing here is stored;
 * the only marks are the home_owed_thread columns lead_clock_from, resurfaced_at, thought_since, auto_drafted_at and
 * the home_item_state column parked_at, and every verdict is recomputed per request from them and `now`.
 *
 * Business days are Monday to Friday in America/New_York, counted by lib/waits/business-days.ts (addBusinessDays) and
 * rules.ts (businessDaysElapsed): "N business days from a time" ends at 17:00 Eastern on the Nth business day after it.
 *
 * The lead clock is the system's own clock. It is not a promise to anyone, and it is never the hard-date chip.
 */

import { addBusinessDays } from '@/lib/waits/business-days';
import { businessDaysElapsed } from '../rules';
import { OWED_CLOCK } from './copy';

/** The columns of home_owed_thread the clock reads. */
export interface ClockRow {
  lead_clock_from?: Date | null;
  not_lead_at?: Date | null;
  thought_since?: Date | null;
}

export interface LeadClock {
  /** The later of their newest message and a "Keep it". */
  start: Date;
  /** When the reply is due (the lead clock days after the start). */
  due: Date;
  /** The clock has run out. */
  past: boolean;
  /** The latest time the lead came back (every leadRepeatDays after the due time), or null before the first. */
  resurfaceAt: Date | null;
  /** Business days since the start. */
  days: number;
  /** At 10 business days the row asks "Keep this lead or let it go?". */
  ask: boolean;
}

export interface OwedClock {
  /** Business days since their newest message. */
  days: number;
  /** From the third business day a client reply goes to the top of its People tile. */
  waiting: boolean;
  /** From the fifth, Bast's unsent draft turns into Needs thought. */
  thoughtDue: boolean;
  /** Present only for a lead. */
  lead: LeadClock | null;
}

/** A newest message that is from a lead and that he has not marked "Not a lead" since it arrived. */
export function isLeadNow(intent: string | null | undefined, newestAt: Date, row: Pick<ClockRow, 'not_lead_at'> | null | undefined): boolean {
  if (intent !== 'sales') return false;
  const notLead = row?.not_lead_at ?? null;
  return !(notLead && notLead.getTime() >= newestAt.getTime());
}

export function leadClock(newestAt: Date, row: ClockRow | null | undefined, now: Date): LeadClock {
  const from = row?.lead_clock_from ?? null;
  const start = from && from.getTime() > newestAt.getTime() ? from : newestAt;
  const due = addBusinessDays(start, OWED_CLOCK.leadDays);
  const past = now.getTime() >= due.getTime();
  let resurfaceAt: Date | null = null;
  if (past) {
    for (let n = 1; n <= 60; n++) {
      const at = addBusinessDays(start, OWED_CLOCK.leadDays + OWED_CLOCK.leadRepeatDays * n);
      if (at.getTime() > now.getTime()) break;
      resurfaceAt = at;
    }
  }
  const days = businessDaysElapsed(start, now);
  return { start, due, past, resurfaceAt, days, ask: days >= OWED_CLOCK.leadAskDays };
}

export function owedClock(newestAt: Date, lead: boolean, row: ClockRow | null | undefined, now: Date): OwedClock {
  const days = businessDaysElapsed(newestAt, now);
  return {
    days,
    waiting: !lead && days >= OWED_CLOCK.waitingDays,
    thoughtDue: !lead && days >= OWED_CLOCK.thoughtDays,
    lead: lead ? leadClock(newestAt, row, now) : null,
  };
}

/** True when a Needs-thought row has sat with no tap for the auto-draft days. */
export function autoDraftDue(thoughtSince: Date | null | undefined, now: Date): boolean {
  if (!thoughtSince) return false;
  return businessDaysElapsed(thoughtSince, now) >= OWED_CLOCK.autoDraftDays;
}

/** The day name in his zone ("Thursday"). */
export function weekdayIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/New_York' }).format(date);
  }
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

/**
 * When a Not now was tapped. A park from before 4c has no parked_at, so it reads as seven days before it ends: a message
 * newer than that wakes it.
 */
export function parkedAtOf(state: { view_at: Date | null; parked_at?: Date | null } | null | undefined): Date | null {
  if (!state || !state.view_at) return null;
  if (state.parked_at) return state.parked_at;
  return new Date(state.view_at.getTime() - SEVEN_DAYS_MS);
}

/**
 * A new message from them ends his own Not now at once. Only his park counts (view_set_by not 'keeper'), and only while
 * the park is still running (view_at in the future).
 */
export function wokeByNewMessage(
  state: { view_at: Date | null; view_set_by: string | null; parked_at?: Date | null } | null | undefined,
  newestAt: Date,
  now: Date,
): boolean {
  if (!state || !state.view_at || state.view_at.getTime() <= now.getTime()) return false;
  if (state.view_set_by === 'keeper') return false;
  const parked = parkedAtOf(state);
  return !!parked && newestAt.getTime() > parked.getTime();
}

/** A lead that came back at its repeat time after he parked it comes back even though he parked it. */
export function leadResurfacedPastPark(
  clock: LeadClock | null,
  state: { view_at: Date | null; view_set_by: string | null; parked_at?: Date | null } | null | undefined,
  now: Date,
): boolean {
  if (!clock || !clock.resurfaceAt) return false;
  if (!state || !state.view_at || state.view_at.getTime() <= now.getTime()) return false;
  if (state.view_set_by === 'keeper') return false;
  const parked = parkedAtOf(state);
  return !!parked && clock.resurfaceAt.getTime() > parked.getTime();
}
