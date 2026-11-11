/**
 * Home screen Slice 6b: the pure clock and the Slack lines for Mike's emergencies.
 *
 * No database, no network. The store (slack-store.ts) hands this file what it read and writes what comes back. Three lines
 * exist, each goes to Mike only:
 *   first     "Needs you now: {title}. {why}. {dashboard url}"      once per item, 07:00 to 22:00 his time (else held to 07:00)
 *   again     "Still waiting on you since {time}: {title}."          once, after 4 working hours with no home action
 *   lifeline  "{title}. {n} days left, and only you can do this one."  once a day after 09:00 until done
 * Titles come from task and mail text, so every piece of text goes through cleanSlackText before it is placed in a line.
 */

import { zonedDateString, zonedToUtc } from '../act';

export const DASHBOARD_URL = 'https://citadel.becomeindelible.com/dashboard';
/** Lines go out from 07:00 (inclusive) to 22:00 (exclusive) his time. */
export const SEND_FROM_HOUR = 7;
export const SEND_TO_HOUR = 22;
/** The lifeline line waits for 09:00, every day of the week. */
export const LIFELINE_FROM_HOUR = 9;
/** Working hours for "still waiting": Monday to Friday, 09:00 to 17:00. */
export const WORK_FROM_HOUR = 9;
export const WORK_TO_HOUR = 17;
export const AGAIN_AFTER_WORKING_HOURS = 4;
/** A claimed line not acknowledged within this long is offered once more. */
export const CLAIM_RETRY_MS = 15 * 60_000;
/** Each line is handed out at most this many times in all (the claim, then one more offer). */
export const MAX_CLAIMS = 2;
export const MAX_LINES_PER_RUN = 6;
export const TITLE_MAX = 120;
export const WHY_MAX = 200;
/** An item that left Needs you now and comes back sooner than this is the same landing, not a new one. */
export const RELAND_AFTER_MS = 60 * 60_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_WORK_DAYS_SCANNED = 90;

export type LineKind = 'first' | 'again' | 'lifeline';

// ============================================================================
// Clock
// ============================================================================

interface Wall {
  h: number;
  mi: number;
  /** 0 = Sunday. */
  dow: number;
}

function wall(at: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour'));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { h: hour === 24 ? 0 : hour, mi: Number(get('minute')), dow };
}

const ymd = (dateString: string): { y: number; m: number; d: number } => {
  const [y, m, d] = dateString.split('-').map(Number);
  return { y, m, d };
};

const civilNum = (c: { y: number; m: number; d: number }): number => Date.UTC(c.y, c.m - 1, c.d) / DAY_MS;

/** True from 07:00 up to, not including, 22:00 on his wall clock. */
export function inSendWindow(now: Date, timeZone: string): boolean {
  const h = wall(now, timeZone).h;
  return h >= SEND_FROM_HOUR && h < SEND_TO_HOUR;
}

/** True from 09:00 up to, not including, 22:00: when the daily lifeline line may go. */
export function inLifelineWindow(now: Date, timeZone: string): boolean {
  const h = wall(now, timeZone).h;
  return h >= LIFELINE_FROM_HOUR && h < SEND_TO_HOUR;
}

/** Milliseconds of working time (Monday to Friday, 09:00 to 17:00 his time) between two instants. 0 when `to` is not after `from`. */
export function workingMsBetween(from: Date, to: Date, timeZone: string): number {
  if (to.getTime() <= from.getTime()) return 0;
  const start = ymd(zonedDateString(from, timeZone));
  const end = ymd(zonedDateString(to, timeZone));
  const days = Math.min(civilNum(end) - civilNum(start), MAX_WORK_DAYS_SCANNED);
  let total = 0;
  for (let i = 0; i <= days; i += 1) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const open = zonedToUtc(y, m, d, WORK_FROM_HOUR, 0, timeZone).getTime();
    const close = zonedToUtc(y, m, d, WORK_TO_HOUR, 0, timeZone).getTime();
    const lo = Math.max(open, from.getTime());
    const hi = Math.min(close, to.getTime());
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/** True once at least 4 working hours have passed between the two instants. */
export function againDue(since: Date, now: Date, timeZone: string): boolean {
  return workingMsBetween(since, now, timeZone) >= AGAIN_AFTER_WORKING_HOURS * HOUR_MS;
}

/** Whole calendar days from today to the hard date's day on his wall clock (0 = today, negative = passed). */
export function daysLeft(hardDate: Date, now: Date, timeZone: string): number {
  return civilNum(ymd(zonedDateString(hardDate, timeZone))) - civilNum(ymd(zonedDateString(now, timeZone)));
}

/** "2026-11-12" (his day) of an instant, the value a lifeline line is recorded against. */
export function lineDay(now: Date, timeZone: string): string {
  return zonedDateString(now, timeZone);
}

// ============================================================================
// Text
// ============================================================================

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Words that never appear on Mike's screen or in Slack, swapped for a plain word.
const WORD_SWAPS: Array<[RegExp, string]> = [
  [/\bpriorities\b/gi, 'important things'],
  [/\bpriority\b/gi, 'important'],
  [/\boverdue\b/gi, 'late'],
];

const chars = (...codes: number[]): string => codes.map((c) => String.fromCharCode(c)).join('');
const DASHES = new RegExp(`[${chars(0x2014, 0x2013)}]`, 'g');
const CONTROLS = new RegExp(`[${chars(0x00)}-${chars(0x1f)}${chars(0x7f)}-${chars(0x9f)}${chars(0x2028, 0x2029)}]`, 'g');
const INVISIBLES = new RegExp(`[${chars(0x200b)}-${chars(0x200f)}${chars(0x202a)}-${chars(0x202e)}${chars(0x2060, 0xfeff)}]`, 'g');

/**
 * Plain single-line text that is safe to place in a Slack message: control characters, line breaks and runs of spaces
 * become one space; em and en dashes become a hyphen; Slack mrkdwn characters (* _ ~ `) are dropped; `<` and `>` (links,
 * mentions, channel and special pings) become spaces; `@` becomes "at" and `&` becomes "and"; the banned words are swapped;
 * the result is cut to `max` characters.
 */
export function cleanSlackText(input: unknown, max: number): string {
  let s = typeof input === 'string' ? input : '';
  s = s
    .replace(DASHES, '-')
    .replace(CONTROLS, ' ')
    .replace(INVISIBLES, '')
    .replace(/&/g, ' and ')
    .replace(/@/g, ' at ')
    .replace(/[<>]/g, ' ')
    .replace(/[*_~`]/g, '');
  for (const [re, to] of WORD_SWAPS) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trimEnd();
  return s;
}

/** A clean piece of a sentence with no closing punctuation, so a line can add its own. */
function piece(input: unknown, max: number): string {
  return cleanSlackText(input, max).replace(/[\s.,;:!?]+$/g, '');
}

/** "Tuesday 9:40 am" on his wall clock. */
export function sinceLabel(at: Date, timeZone: string): string {
  const w = wall(at, timeZone);
  const hour12 = w.h % 12 === 0 ? 12 : w.h % 12;
  return `${WEEKDAYS[w.dow]} ${hour12}:${String(w.mi).padStart(2, '0')} ${w.h < 12 ? 'am' : 'pm'}`;
}

export function firstLineText(title: string, why: string): string {
  const t = piece(title, TITLE_MAX) || 'Something that needs you';
  const w = piece(why, WHY_MAX);
  return w ? `Needs you now: ${t}. ${w}. ${DASHBOARD_URL}` : `Needs you now: ${t}. ${DASHBOARD_URL}`;
}

export function againLineText(title: string, since: Date, timeZone: string): string {
  const t = piece(title, TITLE_MAX) || 'Something that needs you';
  return `Still waiting on you since ${sinceLabel(since, timeZone)}: ${t}.`;
}

/** `days` is null when the item carries no date. */
export function lifelineLineText(title: string, days: number | null): string {
  const t = piece(title, TITLE_MAX) || 'Something that needs you';
  if (days === null) return `${t}. Only you can do this one.`;
  if (days < 0) return `${t}. The date has passed, and only you can do this one.`;
  if (days === 0) return `Today is the last day: ${t}.`;
  return `${t}. ${days} ${days === 1 ? 'day' : 'days'} left, and only you can do this one.`;
}

// ============================================================================
// What is due now
// ============================================================================

/** One item in Needs you now, as the planner needs it. */
export interface WatchItem {
  key: string;
  title: string;
  why: string;
  /** True for a lifeline item (the lifeline rule is the one that put it there). */
  lifeline: boolean;
  /** The lifeline's hard date, or null. */
  hard_date: Date | null;
  /** True for a Kuma site-down row the uptime watchdog already escalated on Slack. */
  watchdog_escalated: boolean;
}

/** The tracked row for an item, as the store read it. */
export interface WatchState {
  id: string;
  item_key: string;
  first_seen_at: Date;
  cleared_at: Date | null;
  acted_at: Date | null;
  slack_first_claimed_at: Date | null;
  slack_first_claims: number;
  slack_first_at: Date | null;
  slack_again_claimed_at: Date | null;
  slack_again_claims: number;
  slack_again_at: Date | null;
  /** The day (YYYY-MM-DD) a lifeline line was acknowledged. */
  lifeline_line_on: string | null;
  /** The day (YYYY-MM-DD) of the last lifeline claim. */
  lifeline_claim_on: string | null;
  lifeline_claimed_at: Date | null;
  lifeline_claims: number;
}

export interface PlannedLine {
  /** The tracked row's id, or `new:<item_key>` for an item a dry run has not tracked yet. */
  id: string;
  kind: LineKind;
  item_key: string;
  text: string;
}

/** A claimed line is offered again once: unacknowledged, 15 minutes old, and claimed fewer than MAX_CLAIMS times. */
function offerable(claims: number, claimedAt: Date | null, now: Date): boolean {
  if (claims === 0 || !claimedAt) return true;
  return claims < MAX_CLAIMS && now.getTime() - claimedAt.getTime() >= CLAIM_RETRY_MS;
}

/** The wire id of a line: the row's id and the kind. */
export const lineId = (rowId: string, kind: LineKind): string => `${rowId}:${kind}`;

export function parseLineId(id: string): { row_id: string; kind: LineKind } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(first|again|lifeline)$/i.exec(id);
  return m ? { row_id: m[1].toLowerCase(), kind: m[2] as LineKind } : null;
}

/**
 * The lines due now, in the order first, again, lifeline per item, at most MAX_LINES_PER_RUN. `states` holds the tracked rows
 * (an item with no row is a first sight and, in a dry run, gets the `new:` id). Items not in `items` are not planned: an item
 * that left Needs you now gets no more lines. Everything outside the send window is held, not dropped.
 */
export function planLines(input: { items: readonly WatchItem[]; states: ReadonlyMap<string, WatchState>; now: Date; timeZone: string }): PlannedLine[] {
  const { items, states, now, timeZone } = input;
  const out: PlannedLine[] = [];
  const sendOk = inSendWindow(now, timeZone);
  const lifelineOk = inLifelineWindow(now, timeZone);
  const today = lineDay(now, timeZone);

  for (const it of items) {
    if (out.length >= MAX_LINES_PER_RUN) break;
    const st = states.get(it.key);
    const id = st ? st.id : `new:${it.key}`;

    // first sight (skipped for a Kuma incident the watchdog already escalated)
    const firstSent = !!st && (st.slack_first_at !== null || st.slack_first_claims >= MAX_CLAIMS);
    if (!it.watchdog_escalated && sendOk && !firstSent && (!st || offerable(st.slack_first_claims, st.slack_first_claimed_at, now))) {
      out.push({ id: st ? lineId(st.id, 'first') : id, kind: 'first', item_key: it.key, text: firstLineText(it.title, it.why) });
    }

    if (!st) continue;

    // still waiting: only after the first line was handed out, once, with no home action and the item still here
    const firstHandedOut = st.slack_first_claimed_at !== null;
    if (out.length < MAX_LINES_PER_RUN && sendOk && firstHandedOut && !st.acted_at) {
      const againSent = st.slack_again_at !== null || st.slack_again_claims >= MAX_CLAIMS;
      const clockStart = st.slack_first_claimed_at && st.slack_first_claimed_at.getTime() > st.first_seen_at.getTime() ? st.slack_first_claimed_at : st.first_seen_at;
      if (!againSent && againDue(clockStart, now, timeZone) && offerable(st.slack_again_claims, st.slack_again_claimed_at, now)) {
        out.push({ id: lineId(st.id, 'again'), kind: 'again', item_key: it.key, text: againLineText(it.title, st.first_seen_at, timeZone) });
      }
    }

    // lifeline: once a day after 09:00, every day, until it is done
    if (out.length < MAX_LINES_PER_RUN && it.lifeline && lifelineOk && st.lifeline_line_on !== today) {
      const claimedToday = st.lifeline_claim_on === today;
      const claims = claimedToday ? st.lifeline_claims : 0;
      if (offerable(claims, claimedToday ? st.lifeline_claimed_at : null, now)) {
        const days = it.hard_date ? daysLeft(it.hard_date, now, timeZone) : null;
        out.push({ id: lineId(st.id, 'lifeline'), kind: 'lifeline', item_key: it.key, text: lifelineLineText(it.title, days) });
      }
    }
  }
  return out;
}
