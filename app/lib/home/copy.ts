/**
 * Home screen Slice 1: every reader-facing string (plan task H4).
 *
 * Laws this file keeps (Mike's, checked by copy.test.ts and copy-guard.test.ts):
 * - No priority label, score, class or the word for a missed deadline, anywhere a person reads.
 * - Elapsed time ("13 days"), never a deadline, unless a real outside date exists (then the
 *   hard-date chip, the only dated text on the screen).
 * - No em dash or en dash in any text on the screen. Text that comes from stored records goes
 *   through displayText(), which swaps a dash for ", " at display time and never changes the
 *   record.
 * - "If you do nothing" lines say only what really happens in Slice 1. Nothing is promised
 *   that a later slice builds (no Bast scan, no Slack line, no automatic hand-off).
 *
 * Pure: no I/O, no Prisma.
 */

import { calendarDaysSince } from '@/lib/waits/business-days';
import type { EmergencyRule } from './rules';
import { THREAD_MAX_AGE_DAYS } from './rules';
import { dueCivil } from './score';
import type { HomeActionId, HomeRestGroupKey, HomeTileId } from './types';

// ============================================================================
// Stored text on the screen
// ============================================================================

/**
 * Text from a stored record (task title, summary, subject, note) as it may appear on screen.
 * An em dash or en dash becomes ", " (a range between two digits becomes " to "). The stored
 * record is never changed. Whitespace is collapsed.
 */
export function displayText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/(\d)\s*\u2013\s*(\d)/g, '$1 to $2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^[,\s]+/, '')
    .replace(/[,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Dates
// ============================================================================

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Real weekday name of a civil date (never hard-coded; computed from the date). */
export function weekdayName(y: number, m: number, d: number): string {
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function zonedCivil(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** The date line at the top of the screen: "Monday, November 9", in the user's zone. */
export function screenDateLine(now: Date, timeZone = 'America/New_York'): string {
  const c = zonedCivil(now, timeZone);
  return `${weekdayName(c.y, c.m, c.d)}, ${MONTHS[c.m - 1]} ${c.d}`;
}

/** Today's date as YYYY-MM-DD in the user's zone (the home_day date). */
export function zonedDateString(now: Date, timeZone = 'America/New_York'): string {
  const c = zonedCivil(now, timeZone);
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/**
 * The hard-date chip: "Due Saturday, November 14", plus " (name)" when the task says who it
 * was promised to. A date-only value counts as its own calendar day; any other instant is read
 * in New York.
 */
export function hardDateChip(date: Date, promisedTo?: string | null): string {
  const c = dueCivil(date);
  const base = `Due ${weekdayName(c.y, c.m, c.d)}, ${MONTHS[c.m - 1]} ${c.d}`;
  const who = displayText(promisedTo);
  return who ? `${base} (${who})` : base;
}

// ============================================================================
// Elapsed time and effort in words
// ============================================================================

/** Whole calendar days since `since`, by New York date. Never negative. */
export function daysSince(since: Date, now: Date): number {
  return calendarDaysSince(since, now);
}

/** Whole 24-hour periods since `since`. Never negative. Used for the age and waited lines. */
function wholeDaysSince(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
}

function dayWord(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** The age line: "filed today" (or "came in today" for mail), "1 day", "13 days". */
export function ageWords(since: Date, now: Date, kind: 'filed' | 'arrived' = 'filed'): string {
  const n = wholeDaysSince(since, now);
  if (n === 0) return kind === 'arrived' ? 'came in today' : 'filed today';
  return dayWord(n);
}

/** How long someone has waited, as a bare phrase: "13 days", "1 day", "less than a day". */
export function waitedFor(since: Date, now: Date): string {
  const n = wholeDaysSince(since, now);
  return n === 0 ? 'less than a day' : dayWord(n);
}

/** Minutes rounded for display: under 10 as is, otherwise to the nearest 5. */
export function roundMinutes(minutes: number): number {
  const m = Math.max(1, Math.round(minutes));
  return m < 10 ? m : Math.round(m / 5) * 5;
}

/** "35 minutes", "1 hour 50 minutes", "2 hours". No "about". */
export function plainDuration(minutes: number): string {
  const m = roundMinutes(minutes);
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  return rem === 0 ? hours : `${hours} ${rem === 1 ? '1 minute' : `${rem} minutes`}`;
}

/** "About 10 minutes". With a draft ready: "Draft ready, about 2 minutes". */
export function effortWords(minutes: number, draftReady = false): string {
  if (draftReady) return `Draft ready, about ${plainDuration(minutes)}`;
  return `About ${plainDuration(minutes)}`;
}

/**
 * The size of the day: "About 1 hour 50 minutes". When it is more than the free time:
 * "About 3 hours 10 minutes, more than today has free".
 */
export function sizeLine(totalMinutes: number, freeMinutes: number): string {
  const base = `About ${plainDuration(totalMinutes)}`;
  return totalMinutes > freeMinutes ? `${base}, more than today has free` : base;
}

// ============================================================================
// Buttons
// ============================================================================

export const ACTION_LABELS: Record<HomeActionId, string> = {
  done: 'Done',
  do_now: "I'll do it now",
  open_task: 'Open',
  let_it_go: 'Let it go',
  approve_all: 'Approve all',
  open_session: 'Open the session',
  approve_wait: 'Approve',
  complete_wait: 'Done',
  open_wait: 'Open',
  open_draft: 'Open the draft',
  open_thread: 'Open the thread',
  no_reply_needed: 'No reply needed',
  handled: 'Handled',
  not_now: 'Not now',
  matters_more: 'This matters more',
  not_emergency: 'Not an emergency',
  stop: 'Stop for now',
  add_to_arc: "Add to today's arc",
  remove_from_arc: 'Remove from arc',
};

/** "Approve all 39". */
export function approveAllLabel(count: number): string {
  return `${ACTION_LABELS.approve_all} ${count}`;
}

// ============================================================================
// Why it is here now (the muted second line)
// ============================================================================

export function whyEmergency(
  rule: EmergencyRule,
  ctx: { client?: string | null; sender?: string | null; outsideDate?: boolean },
): string {
  const client = displayText(ctx.client);
  switch (rule) {
    case 'security':
      return client ? `A security flag is open on ${client}'s site.` : 'A security flag is open on a live site.';
    case 'lifeline':
      return 'Something that keeps running depends on this.';
    case 'client_blocking_tag':
      return client ? `${client} is blocked until this is done.` : 'A client is blocked until this is done.';
    case 'client_waiting':
      return client ? `${client} is blocked and waiting.` : 'A client is blocked and waiting.';
    case 'session_client_blocking':
      return 'A client is blocked until you answer this session.';
    case 'crisis_mail': {
      const sender = displayText(ctx.sender);
      return sender ? `An urgent email from ${sender} is still open.` : 'An urgent email is still open.';
    }
    case 'promised_date':
      return ctx.outsideDate ? 'A real outside date is close.' : 'A date you promised is close.';
  }
}

/** Slice 2: the line on a task he just made. `chat` is true when it carries the from-chat tag. */
export function whyFresh(chat: boolean): string {
  return chat ? 'New from the chat.' : 'New, made by you.';
}

/** Slice 3: who a task Bast stopped on shows as, and why it is listed. */
export const BOT_WHO = 'Bast';
export const WHY_BOT_STOPPED = 'Bast stopped on this and needs you.';

/** Slice 2: a task the nightly sort gave a day to, on that day. */
export const WHY_ARRIVED = 'Back today, after waiting its turn.';

export function whyTask(ctx: {
  who: string | null;
  client: string | null;
  personWaiting: boolean;
  /** waitedFor(): "13 days" or "less than a day". */
  waited: string;
  unblocks: number;
  daysOnList: number;
}): string {
  if (ctx.personWaiting && ctx.who) return `${displayText(ctx.who)} has waited ${ctx.waited}.`;
  if (ctx.client) return `It is work for ${displayText(ctx.client)}.`;
  if (ctx.unblocks > 0) return `It holds up ${ctx.unblocks} other ${ctx.unblocks === 1 ? 'task' : 'tasks'}.`;
  if (ctx.daysOnList > 0) return `It has been on your list for ${dayWord(ctx.daysOnList)}.`;
  return 'It was filed today.';
}

export function whySignOff(ctx: { pieces: number; since: string }): string {
  const noun = ctx.pieces === 1 ? 'finished piece has' : 'finished pieces have';
  return `${ctx.pieces} ${noun} waited ${ctx.since} for your sign-off.`;
}

export function whySession(ctx: { since: string }): string {
  return `A session has waited ${ctx.since} for your answer.`;
}

export function whyWait(ctx: { needsHuman: boolean }): string {
  return ctx.needsHuman ? 'A wait is open and needs you.' : 'A wait has come due.';
}

export function whyThread(ctx: { lead: boolean; since: string; draftReady: boolean }): string {
  const head = ctx.lead ? `A sales reply, waiting ${ctx.since}.` : `Waiting on your reply for ${ctx.since}.`;
  return ctx.draftReady ? `${head} A draft is ready.` : head;
}

// ============================================================================
// Why it's here (the muted footer: why this row sits where it does)
// ============================================================================

export function reasonEmergency(rule: EmergencyRule, outsideDate = false): string {
  switch (rule) {
    case 'security':
      return 'A security flag on a live client site always goes first.';
    case 'lifeline':
      return 'Something that keeps running depends on it, so it always goes first.';
    case 'client_blocking_tag':
      return 'A client is blocked on it, so it always goes first.';
    case 'client_waiting':
      return 'A client has been blocked for more than a business day.';
    case 'session_client_blocking':
      return 'The session says a client is blocked.';
    case 'crisis_mail':
      return 'Urgent mail from a real sender goes first.';
    case 'promised_date':
      return outsideDate
        ? 'A real outside date is two business days away or less.'
        : 'A date you promised is two business days away or less.';
  }
}

export const REASON = {
  lead: 'Sales replies show from the first minute.',
  mail: 'A known person is waiting on a reply, and a business day has passed.',
  boosted: 'You said this matters more.',
  signOff: 'Finished pieces wait for your yes.',
  session: 'A session is waiting for your answer.',
  wait: 'A wait that needs you is open.',
  class1: 'A client is involved and the wait is growing.',
  class2: 'Money, a live site or a real date is involved.',
  class3: 'It holds up other work.',
  fresh: 'You made it in the last two business days, so it shows here first.',
  arrived: 'The nightly sort gave it today as its day to come back.',
  botStopped: 'It is Bast\'s task, and Bast tagged it as needing you.',
  working: 'You are doing this now.',
  rest: 'It is on your plate and not due to come forward yet.',
} as const;

/** Footer reason for a step that is not shown in any list. */
export function reasonArcStep(groupName: string): string {
  return `One of the open steps for ${displayText(groupName)}.`;
}

// ============================================================================
// If you do nothing (Slice 1 only: what really happens)
// ============================================================================

export const IF_IGNORED = {
  stays: 'Stays here. Nothing happens on its own.',
  emergency: 'Stays at the top. Nothing happens on its own.',
  crisis: 'Stays at the top until you mark it handled. Nothing happens on its own.',
  thread: `Stays here. After ${THREAD_MAX_AGE_DAYS} days it moves to Everything else. Nothing is sent for you.`,
  signOff: 'Stays here. Nothing is approved until you approve it.',
  session: 'Stays here. The session keeps waiting for you.',
  wait: 'Stays here. The wait keeps its own clock.',
  botStopped: 'Stays with Bast, stopped, until you answer on the task.',
} as const;

// ============================================================================
// Today
// ============================================================================

/** "Why this arc": the top step's reason, plus how many more steps wait. */
export function whyThisArc(topWhy: string, otherSteps: number, groupName: string): string {
  const head = topWhy.replace(/[.\s]+$/, '');
  if (otherSteps <= 0) return head;
  const name = displayText(groupName);
  return `${head}, and ${otherSteps} more for ${name} ${otherSteps === 1 ? 'waits' : 'wait'} on you`;
}

/** One-line reason for a Swap or Lighter choice. */
export function whyChoice(topWhy: string): string {
  return topWhy.replace(/[.\s]+$/, '');
}

// ============================================================================
// Empty sentences, Everything else, Handled
// ============================================================================

export const EMPTY_TILE: Record<HomeTileId, string> = {
  today: 'Nothing is proposed for today.',
  needs_you_now: 'Nothing urgent.',
  working_on: 'Nothing in progress.',
  leads: 'No one is waiting on a reply from you.',
  mail: 'No one is waiting on a reply from you.',
  next: 'Nothing needs a decision from you right now.',
  projects: 'No active projects.',
  handled: 'Nothing new since you last looked.',
  everything_else: '',
};

export function emptySentences(): Record<HomeTileId, string> {
  return { ...EMPTY_TILE };
}

export const REST_GROUP_COPY: Record<HomeRestGroupKey, { label: string; owner: string }> = {
  waiting_turn: { label: 'Waiting their turn', owner: 'You' },
  scheduled: { label: 'Given a day to come back', owner: 'You' },
  parked: { label: 'Parked by you', owner: 'You' },
  held_projects: { label: 'On paused or unsigned projects', owner: 'Each project' },
  review_pieces: { label: 'Review pieces folded under a sign-off', owner: "Each project's sign-off" },
  new_mail: { label: 'New mail, shown after one business day', owner: 'You' },
  older_threads: { label: 'Older open threads', owner: 'You' },
  ventures: { label: 'Other ventures', owner: 'You, other hat' },
  bast_stopped: { label: 'Stopped with Bast, waiting on you', owner: 'Bast' },
};

/**
 * "52 other items are counted here. 41 have a day to come back. 3 are past their day."
 * With nothing past: "None is past its day."
 */
export function everythingElseLine(count: number, withDay = 0, pastDay = 0): string {
  if (count <= 0) return 'Nothing else is on your plate.';
  const head = count === 1 ? '1 other item is counted here.' : `${count} other items are counted here.`;
  const day = withDay === 1 ? '1 has a day to come back.' : `${withDay} have a day to come back.`;
  const past = pastDay <= 0 ? 'None is past its day.' : pastDay === 1 ? '1 is past its day.' : `${pastDay} are past their day.`;
  return `${head} ${day} ${past}`;
}

/** "5 tasks on unsigned or paused projects are kept as scope, not work." Null when there are none. */
export function scopeLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '1 task on an unsigned or paused project is kept as scope, not work.';
  return `${count} tasks on unsigned or paused projects are kept as scope, not work.`;
}

/** The one button on a drawer row that can move. */
export const BRING_FORWARD_LABEL = 'Bring it forward';

/** "Back Thursday, November 12", in the user's zone. */
export function backOnText(date: Date, timeZone = 'America/New_York'): string {
  return `Back ${screenDateLine(date, timeZone)}`;
}

/** Check texts for the Everything else rows. */
export const REST_CHECK = {
  joinsNext: 'Joins Next when a row frees up',
  getsDay: "Gets a day in tonight's sort",
  newMail: 'Shows after one business day',
  olderThread: 'No set day. Open the thread to answer or close it.',
  venture: 'No set day. Other hat.',
  botStopped: 'Shows here one at a time. Open it to answer.',
  /** Not in the plan's table: a people row beyond its cap, a wait not yet due, a crisis mail marked not an emergency. */
  peopleOverflow: 'Shows when a row frees up',
  waitNotDue: 'Comes up when the wait is due',
  crisisCleared: 'Marked not an emergency. Open it to close it.',
} as const;

export function whenProjectStarts(project: string): string {
  return `When ${displayText(project)} starts`;
}

export function withSignOff(project: string | null): string {
  return project ? `With the ${displayText(project)} sign-off` : 'With the sign-off';
}

/** A quiet "Handled for you" line for a classifier auto-close. */
export function handledLine(ctx: { who: string; subject: string }): string {
  const subject = displayText(ctx.subject);
  const who = displayText(ctx.who);
  return subject
    ? `Closed ${who}'s message "${subject}". The email sorter marked it handled.`
    : `Closed ${who}'s message. The email sorter marked it handled.`;
}

/** "4 more handled". */
export function handledMoreText(count: number): string {
  return `${count} more handled`;
}
