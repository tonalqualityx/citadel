/**
 * Work stage A: the words on Mike's screen for linked and closed emails. Plain words, no em or en dash (displayText
 * swaps any that a stored subject carries), and none of the banned words. The home dash guard scans this folder.
 */

import { displayText } from '@/lib/home/copy';

const ZONE = 'America/New_York';

/** "Nov 2". */
export function shortDate(d: Date, zone: string = ZONE): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(d);
}

/** "Jeffrey Knisely", "Jeffrey Knisely and 1 other", "Jeffrey Knisely and 2 others". */
export function fromLabel(names: readonly string[]): string {
  const n = Array.from(new Set(names.map((x) => displayText(x)).filter((x) => x !== '')));
  if (n.length === 0) return 'a sender';
  if (n.length === 1) return n[0];
  const rest = n.length - 1;
  return `${n[0]} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

const emails = (count: number) => (count === 1 ? '1 email' : `${count} emails`);

/** The line for one task finishing: `Closed 2 emails from Jeffrey Knisely: done in "Add the blurb" (Nov 2).` */
export function taskClosedLine(ctx: { count: number; from: readonly string[]; title: string; status: 'done' | 'abandoned'; date: Date; zone?: string }): string {
  const title = displayText(ctx.title) || 'a task';
  const why = ctx.status === 'done' ? `done in "${title}"` : `"${title}" was dropped`;
  return `Closed ${emails(ctx.count)} from ${fromLabel(ctx.from)}: ${why} (${shortDate(ctx.date, ctx.zone)}).`;
}

/** The nightly catch-up's line. */
export function catchupLine(count: number, tasks: number): string {
  return `Closed ${emails(count)} whose ${tasks === 1 ? 'task is' : 'tasks are'} finished.`;
}

/** The one-time tidy's line: `Linked 37 emails to their tasks and closed 22 whose tasks are finished.` */
export function backfillLine(linked: number, closed: number): string {
  return `Linked ${emails(linked)} to their tasks and closed ${closed} whose tasks are finished.`;
}

/** One detail line per email: `Jeffrey Knisely, Nov 2: Website update. <link>`. */
export function askDetail(ask: { from_name: string | null; from_email: string; subject: string; received_at: Date; deep_link: string }, zone?: string): string {
  const who = displayText(ask.from_name) || ask.from_email;
  const subject = displayText(ask.subject) || 'No subject';
  return `${who}, ${shortDate(ask.received_at, zone)}: ${subject}. ${ask.deep_link}`;
}

/** One detail line per task: `Task: Add the blurb. /tasks/<id>`. */
export function taskDetail(task: { id: string; title: string }): string {
  return `Task: ${displayText(task.title) || 'Untitled task'}. /tasks/${task.id}`;
}

/** The Email line on a task card: `Jeffrey Knisely, Nov 2: Website update`. The card's link opens the email. */
export function emailLinkLabel(ask: { from_name: string | null; from_email: string; subject: string; received_at: Date }, zone?: string): string {
  const who = displayText(ask.from_name) || ask.from_email;
  const subject = displayText(ask.subject) || 'No subject';
  return `Email: ${who}, ${shortDate(ask.received_at, zone)}: ${subject}`;
}

// ----------------------------------------------------------------------------
// Work stage B: the one intake decision
// ----------------------------------------------------------------------------

/** The quiet line for one mail recorded as handled at birth: `Recorded as handled: Ken Duffy, "Appreciate it Mike". No reply needed.` */
export function recordedLine(ask: { from_name: string | null; from_email: string; subject: string; kind: string }): string {
  const who = displayText(ask.from_name) || ask.from_email;
  const subject = displayText(ask.subject) || 'No subject';
  const tail = ask.kind === 'waiting_them' ? 'Waiting on them.' : 'No reply needed.';
  return `Recorded as handled: ${who}, "${subject}". ${tail}`;
}

/** The one line for a replay batch. */
export function intakeBatchLine(count: number): string {
  return `Recorded ${emails(count)} as handled: no reply needed.`;
}

/** The line when a booked meeting closes a request for a time. */
export function meetingBookedLine(names: readonly string[], title: string, startsAt: Date, zone?: string): string {
  const what = displayText(title) || 'a meeting';
  return `Closed the request for a time from ${fromLabel(names)}: "${what}" is booked for ${shortDate(startsAt, zone)}.`;
}

/** The detail line of a handled-mail row: Bast's reason, or the plain default. */
export function handledReason(kind: string, reason: string | null): string {
  const r = displayText(reason ?? '').replace(/[.\s]+$/, '');
  if (r) return `${r}.`;
  return kind === 'waiting_them' ? 'Waiting on them.' : 'No reply needed.';
}

/** The weekly measures line: `Recorded 41 emails as handled. You reopened 1.` */
export function handledMeasureLine(recorded: number, reopened: number): string {
  return `Recorded ${emails(recorded)} as handled. You reopened ${reopened}.`;
}

export const HANDLED_MAIL = {
  title: 'Mail recorded as handled',
  intro: 'The last 30 days. Each one needed no reply from you. Undo puts it back as a reply you owe.',
  showAll: 'Show all',
  empty: 'Nothing was recorded as handled in the last 30 days.',
  undone: 'Put back as a reply you owe.',
  /** The meta line of a meeting request row. */
  wantsATime: 'Wants a time',
  meetingWhy: 'Asked for a time to meet.',
} as const;
