/**
 * Home Slice 4d: where a "Book 30 minutes" block goes. Pure: events, the clock and his zone in, one slot (or none) out.
 *
 * The rule, in his time:
 * - today or the next business day (the first two business days counting from today, Monday to Friday; the repo has no holiday calendar)
 * - between 10:00 and 17:00, the whole half hour inside that window
 * - not within 20 minutes before or 30 minutes after a timed meeting (an all-day event never blocks)
 * - at least 15 minutes from now
 * - 30 minutes long, starting on a quarter hour
 * Returns the first slot that fits, or null (the act then answers a plain refusal and writes nothing).
 */

export const SLOT = {
  startHour: 10,
  endHour: 17,
  minutes: 30,
  beforeMs: 20 * 60_000,
  afterMs: 30 * 60_000,
  leadMs: 15 * 60_000,
  gridMs: 15 * 60_000,
  businessDays: 2,
} as const;

/** The refusal Mike reads when nothing fits. */
export const NO_FREE_SLOT = 'No free half hour found in the next two days.';

export interface SlotEvent {
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
}

export interface Slot {
  start: Date;
  end: Date;
}

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wall(date: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const h = get('hour');
  return { y: get('year'), m: get('month'), d: get('day'), h: h === 24 ? 0 : h, mi: get('minute'), s: get('second') };
}

/** The UTC instant of y-m-d h:mi on the wall clock of the zone. */
function zoned(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const nominal = Date.UTC(y, m - 1, d, h, mi);
  let guess = nominal;
  for (let i = 0; i < 3; i++) {
    const w = wall(new Date(guess), timeZone);
    guess = nominal - (Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - guess);
  }
  return new Date(guess);
}

/** Pick the first free half hour, or null. `busy` are extra blocks (other pending bookings) treated like timed meetings. */
export function pickSlot(events: readonly SlotEvent[], now: Date, timeZone: string): Slot | null {
  const timed = events.filter((e) => !e.all_day && e.ends_at.getTime() > e.starts_at.getTime());
  const blocks = timed.map((e) => ({ from: e.starts_at.getTime() - SLOT.beforeMs, to: e.ends_at.getTime() + SLOT.afterMs }));
  const earliest = now.getTime() + SLOT.leadMs;
  const length = SLOT.minutes * 60_000;

  const w = wall(now, timeZone);
  let found = 0;
  for (let ahead = 0; ahead < 10 && found < SLOT.businessDays; ahead++) {
    const day = new Date(Date.UTC(w.y, w.m - 1, w.d + ahead));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    found += 1;
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const open = zoned(y, m, d, SLOT.startHour, 0, timeZone).getTime();
    const close = zoned(y, m, d, SLOT.endHour, 0, timeZone).getTime();
    let t = Math.max(open, earliest);
    // Round up to the next quarter hour on his wall clock.
    const tw = wall(new Date(t), timeZone);
    const extra = tw.mi % 15 === 0 && tw.s === 0 ? 0 : 15 - (tw.mi % 15);
    if (extra > 0 || tw.s > 0) {
      t = zoned(tw.y, tw.m, tw.d, tw.h, tw.mi - (tw.mi % 15) + 15, timeZone).getTime();
    }
    for (; t + length <= close; t += SLOT.gridMs) {
      if (blocks.some((b) => t < b.to && t + length > b.from)) continue;
      return { start: new Date(t), end: new Date(t + length) };
    }
  }
  return null;
}

/** The span a caller should read events over: from now to the end of the second business day's window, with a margin. */
export function slotSearchSpan(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 24 * 3_600_000), to: new Date(now.getTime() + 6 * 24 * 3_600_000) };
}
