/**
 * Home Slice 9a: every sentence the sent-mail reconciler puts on Mike's screen. Plain words. No em or en dash, never "priority" or
 * the word for a missed deadline (copy-guard.test.ts and the gate grep read this folder). A dash inside his own quoted words is
 * shown as " - " (plainQuote). Pure: no I/O.
 */
import type { WhyCode } from './decide';
import { plainQuote } from './evidence';
import { minutesWords } from './estimate';
import type { Placement } from './placement';

const ZONE = 'America/New_York';

/** One plain line from stored or model text: collapsed whitespace, a dash swapped, at most `max` characters. */
export function plainLine(text: string | null | undefined, max = 200): string {
  const t = plainQuote(String(text ?? '')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}.`;
}

export function dayWords(d: Date, zone: string = ZONE): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}
export function shortDay(d: Date, zone: string = ZONE): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'long', day: 'numeric' }).format(d);
}
export function monthWords(d: Date, zone: string = ZONE): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'long' }).format(d);
}

/** "Kue Chen", "Kue Chen and 1 other", "Kue Chen and 2 others". */
export function whoLabel(names: string[]): string {
  const n = names.filter((x) => x.trim() !== '');
  if (n.length === 0) return 'someone';
  if (n.length === 1) return n[0];
  return `${n[0]} and ${n.length - 1} ${n.length - 1 === 1 ? 'other' : 'others'}`;
}

/** The internal note on the task. The quote is his own words. */
export function noteText(a: { who: string; sent: Date; quote: string; link: string }): string {
  return `From Mike's sent mail. Email to ${a.who} on ${dayWords(a.sent)}: "${plainQuote(a.quote)}" Open the email: ${a.link}`;
}

/** The Handled for you line of an automatic note. */
export function noteLine(taskTitle: string, who: string, sent: Date): string {
  return `Noted on "${plainLine(taskTitle, 90)}" from your email to ${who}, ${shortDay(sent)}.`;
}

export const IF_IGNORED_CARD = 'Stays here. Nothing changes until you tap.';
export const IF_IGNORED_TRACK = 'Stays here for two weeks, then goes quietly. Nothing is made until you tap.';

export function quoteLine(who: string, sent: Date, quote: string): string {
  return `Your email to ${who}, ${dayWords(sent)}: "${plainQuote(quote)}"`;
}

export function whyAsk(why: WhyCode, ctx: { owner?: string } = {}): string {
  switch (why) {
    case 'security':
      return 'Why Bast asks: it is a security task, so Bast never closes it on its own.';
    case 'someone_else':
      return `Why Bast asks: it is ${ctx.owner ? `${plainLine(ctx.owner, 40)}'s` : "someone else's"} task, so Bast never changes it from your mail.`;
    case 'unsure':
      return 'Why Bast asks: Bast is not sure.';
    case 'older':
      return 'Why Bast asks: it is from older mail.';
    case 'commitment':
      return 'Why Bast asks: your email mentions a price or a date.';
    case 'bast_words':
      return 'Why Bast asks: Bast wrote those words.';
    case 'wrong_hold':
      return 'Why Bast asks: you marked an earlier note on this task as wrong.';
    case 'cap':
      return 'Why Bast asks: Bast has already added its notes for today.';
    case 'reach':
      return 'Why Bast asks: Bast is working on this task, so a note needs your yes.';
    case 'new_work':
      return 'Why Bast asks: this work is not in Citadel yet.';
    case 'manual':
      return 'Why Bast asks: Bast only suggests this kind of change.';
  }
}

export const TITLES = {
  done: (didPhrase: string) => `Your email says you ${plainLine(didPhrase, 90).replace(/[.]+$/, '')}. Mark this done?`,
  note: (who: string, owner: string, taskTitle: string) => `Your email to ${who} is about ${plainLine(owner, 40)}'s task "${plainLine(taskTitle, 90)}". Add a note?`,
  noteOwn: (who: string, taskTitle: string) => `Your email to ${who} is about your task "${plainLine(taskTitle, 90)}". Add a note?`,
  waiting: (name: string, what: string) => `You asked ${plainLine(name, 60)} for ${plainLine(what, 90).replace(/[.]+$/, '')}. Wait on them?`,
  session: (who: string, sessionTitle: string) => `Your email to ${who} answers "${plainLine(sessionTitle, 90)}". Clear the question?`,
  wait: (name: string, what: string) => `You asked ${plainLine(name, 60)} for ${plainLine(what, 90).replace(/[.]+$/, '')}. Wait on them?`,
  track: (title: string) => {
    const t = plainLine(title, 110).replace(/[.]+$/, '');
    const body = /^you\b/i.test(t) ? t : `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
    return `${body}. Track it?`;
  },
};

export const BUTTONS = {
  markDone: 'Mark it done',
  addNote: 'Add the note',
  clear: 'Clear the question',
  waitOnThem: 'Wait on them',
  notYet: 'Not yet',
  no: 'No',
  trackIt: 'Track it',
  startProject: 'Start a project for it',
  startNewProject: 'Start a new project',
  noLeaveIt: 'No, leave it',
  notNow: 'Not now',
  openEmail: 'Open the email',
  addTo: (project: string) => `Add to ${plainLine(project, 60)}`,
};

/** The lines of a Track it card, built once by the server when the card is made. */
export interface TrackLineInput {
  who: string;
  sent: Date;
  quote: string;
  done_title: string;
  minutes: number;
  estimate_basis: string;
  retainer_hours: number | null;
  client_name: string;
  placement: Placement;
  next_step: string;
  later: string[];
}

export function trackLines(a: TrackLineInput): string[] {
  const out = [quoteLine(a.who, a.sent, a.quote)];
  out.push(`Done: ${plainLine(a.done_title, 120).replace(/[.]+$/, '')} (${dayWords(a.sent)}).`);
  out.push(`Time spent: about ${minutesWords(a.minutes)}. This is Bast's estimate: ${plainLine(a.estimate_basis, 240).replace(/[.]+$/, '')}. Change it before you tap.`);
  out.push(
    a.retainer_hours !== null
      ? `Counts toward ${plainLine(a.client_name, 60)}'s retainer for ${monthWords(a.sent)}.`
      : 'Logged as billable time. Change that on the task page.'
  );
  switch (a.placement.kind) {
    case 'add':
      out.push(`Where it goes: ${plainLine(a.placement.project.name, 80)}.`);
      break;
    case 'ask':
      out.push(`Add to ${plainLine(a.placement.project.name, 80)} or start a new project?`);
      break;
    case 'new':
      out.push('No live project for this yet. A new project will be made for it.');
      break;
    case 'loose':
      out.push(`Where it goes: ${plainLine(a.client_name, 60)}, with no project.`);
      break;
  }
  if (a.next_step.trim() !== '') out.push(`Next: ${plainLine(a.next_step, 200)}`);
  const later = a.later.filter((l) => l.trim() !== '').map((l) => plainLine(l, 120).replace(/[.]+$/, ''));
  if (later.length > 0) out.push(`Later: ${later.join('. ')}.`);
  return out;
}

/** Toast after Track it. */
export function trackToast(tasks: number, minutes: number | null, client: string): string {
  const t = `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`;
  return minutes ? `Tracked: ${t} and ${minutesWords(minutes)} on ${plainLine(client, 60)}.` : `Tracked: ${t} on ${plainLine(client, 60)}.`;
}

export const TAP_ON_SCREEN = 'Tap this on the home screen.';
export const CHANGED_SINCE = 'Changed since. Open the task.';
export const CARD_GONE = 'That card is not open any more.';
export const LOG_TIME_PROMPT = (minutes: number) => `Log time? ${minutes} min`;
export const NOTE_UNDONE = 'The note is hidden. Nothing was deleted.';
export const WRONG_UNDONE = 'Hidden. Bast will not change that task from your mail for 90 days.';
