/**
 * Home screen Slice 8a: the words in the project drawer. Plain sentences, dates written out,
 * no em or en dash, no number from scoring. Pure, so the browser and the server share it.
 */

import { displayText } from '../copy';

export const OPEN_FULL_PROJECT_LABEL = 'Open the full project';
export const NO_ITEMS_TEXT = 'Nothing of yours is open on this project.';
export const WAITING_HEADING = 'Waiting on others';
export const ITEMS_HEADING = 'Yours here';
export const LOAD_FAILED_TEXT = 'This did not load.';
export const RETRY_LABEL = 'Try again';
export const LOADING_TEXT = 'Loading.';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

interface Civil {
  y: number;
  m: number;
  d: number;
}

function civil(date: Date, timeZone: string): Civil {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Whole calendar days from `since` to `now` in the zone. Never negative. */
export function calendarDays(since: Date, now: Date, timeZone: string): number {
  const a = civil(since, timeZone);
  const b = civil(now, timeZone);
  return Math.max(0, Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000));
}

/** "Tuesday, November 3". */
export function dayWithWeekday(date: Date, timeZone: string): string {
  const c = civil(date, timeZone);
  return `${WEEKDAYS[new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay()]}, ${MONTHS[c.m - 1]} ${c.d}`;
}

/** "October 20". */
export function dayShort(date: Date, timeZone: string): string {
  const c = civil(date, timeZone);
  return `${MONTHS[c.m - 1]} ${c.d}`;
}

/** The date a clock started, written out: with the weekday inside the last two weeks ("Tuesday, November 3"), without it after ("October 20"). */
export function sinceDay(since: Date, now: Date, timeZone: string): string {
  return calendarDays(since, now, timeZone) < 14 ? dayWithWeekday(since, timeZone) : dayShort(since, timeZone);
}

export function daysText(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** "22 days" in brackets after a date; nothing when it started today. */
export function sinceWithDays(since: Date, now: Date, timeZone: string): string {
  const n = calendarDays(since, now, timeZone);
  return n === 0 ? 'today' : `${sinceDay(since, now, timeZone)} (${daysText(n)})`;
}

export function needsNowSentence(n: number): string {
  return n === 1 ? '1 thing here needs you now.' : `${n} things here need you now.`;
}

/** The phrase for one kind of blocker waiting on him, or null for a kind that is not an ask of him. */
export function blockerPhrase(kind: string, count: number): string | null {
  const many = (one: string, plural: string) => (count === 1 ? one : `${count} ${plural}`);
  switch (kind) {
    case 'review':
      return 'a sign-off';
    case 'decision':
      return many('1 decision', 'decisions');
    case 'clarification':
      return many('1 question to answer', 'questions to answer');
    case 'session_ask':
      return many('1 question from a working session', 'questions from working sessions');
    case 'client_approval':
      return many('1 approval to send', 'approvals to send');
    case 'client_email':
      return many('1 client email', 'client emails');
    case 'mention':
      return many('1 mention', 'mentions');
    case 'meeting_risk':
      return many('1 meeting at risk', 'meetings at risk');
    default:
      return null;
  }
}

/** The order the phrases are listed in. */
export const BLOCKER_PHRASE_ORDER = ['review', 'decision', 'clarification', 'session_ask', 'client_approval', 'client_email', 'mention', 'meeting_risk'] as const;

export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The Oracle text starts with "Mike, " (Bast's engine addresses him); on his own screen the name is dropped. */
export function stripMikePrefix(text: string): string {
  const cleaned = displayText(text).replace(/^mike\s*[,:]\s*/i, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function clockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date).replace(/\s/g, ' ').replace(' AM', ' am').replace(' PM', ' pm');
}

/** "Bast wrote this at 3:00 am today." or "Bast wrote this on Tuesday, November 3." */
export function nextStepSource(
  step: { source: 'graph' | 'bast' | 'mike' | 'none'; at: string | null },
  now: Date,
  timeZone: string,
): string | null {
  const at = step.at ? new Date(step.at) : null;
  if (step.source === 'bast') {
    if (!at) return 'Bast wrote this.';
    return calendarDays(at, now, timeZone) === 0
      ? `Bast wrote this at ${clockTime(at, timeZone)} today.`
      : `Bast wrote this on ${dayWithWeekday(at, timeZone)}.`;
  }
  if (step.source === 'mike') return 'You wrote this.';
  if (step.source === 'graph') return 'This came from the task list.';
  return null;
}

/** "Yours" or "Andy's" (the owner of the next step), or null when no one owns it. */
export function nextStepOwner(
  step: { owner: { id: string; name: string } | null; owner_label: string | null },
  userId: string,
): string | null {
  if (step.owner) return step.owner.id === userId ? 'Yours' : `${displayText(step.owner.name)}'s`;
  if (step.owner_label) return `${displayText(step.owner_label)}'s`;
  return null;
}

/** "Tuesday, November 3, Pat Smith: the gist or the subject". Returns the link text; the href is the email's own link. */
export function lastEmailText(
  email: { from: string; subject: string; gist: string | null; received_at: string },
  timeZone: string,
): string {
  const what = displayText(email.gist) || displayText(email.subject);
  const who = displayText(email.from);
  const day = dayWithWeekday(new Date(email.received_at), timeZone);
  return `Last client email: ${day}, ${who}: ${what}`;
}
