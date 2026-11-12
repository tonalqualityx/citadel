/**
 * Work stage D: the words on Mike's screen for attached sources, the one question and the state line. Plain words, no em or en dash
 * (displayText swaps any that a stored subject carries), and none of the banned words. The home dash guard scans this folder.
 */

import { displayText } from '@/lib/home/copy';
import { shortDate } from './copy';

const q = (s: string): string => `"${displayText(s)}"`;

/** The Handled line of a quiet attach: `Added the email from Ashlei to "Thermalnetics website".` */
export function attachedLine(kind: string, who: string | null, targetName: string): string {
  const name = q(targetName || 'that work');
  switch (kind) {
    case 'email':
      return `Added the email from ${displayText(who) || 'a sender'} to ${name}.`;
    case 'session':
      return `Added the session ${q(who || 'a session')} to ${name}.`;
    case 'calendar':
      return `Added the meeting ${q(who || 'a meeting')} to ${name}.`;
    default:
      return `Added ${displayText(who) || 'an item'} to ${name}.`;
  }
}

/** The question: `New email from Ashlei (Thermalnetics): add to "Thermalnetics website" or "Thermalnetics hosting", or start a new project?` */
export function attachQuestion(ctx: { kind: string; who: string | null; client: string | null; candidates: readonly string[] }): string {
  const who = displayText(ctx.who) || (ctx.kind === 'session' ? 'a session' : 'a sender');
  const client = ctx.client ? ` (${displayText(ctx.client)})` : '';
  const head = ctx.kind === 'session' ? `Session ${q(who)}${client}` : ctx.kind === 'email' ? `New email from ${who}${client}` : `${displayText(ctx.kind)} ${q(who)}${client}`;
  const names = ctx.candidates.map(q);
  if (names.length === 0) return `${head}: no live project for it yet. Start a new project?`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `${head}: add to ${list}, or start a new project?`;
}

export const ATTACH_CARD = {
  newProject: 'New project',
  justATask: 'Just a task',
  notWork: 'Not work',
  openSource: 'Open it',
  reason: 'Nothing was attached on a guess.',
  whyNow: 'It could belong to more than one piece of work.',
  ifIgnored: 'It stays here. Nothing is added to your list for it.',
  title: (n: number) => (n === 1 ? 'Where does this belong?' : `Where do these ${n} belong?`),
} as const;

/** What a tap on the question did, for the toast. */
export const ATTACH_TOAST = {
  attached: (name: string) => `Added to ${q(name)}.`,
  newProject: (name: string) => `Started the project ${q(name)}.`,
  task: (title: string) => `Made a task ${q(title)}.`,
  notWork: 'Left as it was. It will not be asked about again.',
} as const;

/** The measures line: `No second to-dos: 6 kept off your list.` */
export function keptOffLine(n: number): string {
  return `No second to-dos: ${n} kept off your list.`;
}

/** The state line of a project or task. `since` is null when nothing says when. */
export function stateLine(state: string, ctx: { since: Date | null; zone?: string; who?: string | null; proof?: string | null }): string {
  const when = ctx.since ? ` since ${shortDate(ctx.since, ctx.zone)}` : '';
  switch (state) {
    case 'done':
      return ctx.since ? `Done ${shortDate(ctx.since, ctx.zone)}` : 'Done';
    case 'looks_done':
      return `Looks done: ${displayText(ctx.proof ?? '').replace(/[.\s]+$/, '') || 'there is proof'}. Close it?`;
    case 'waiting_them':
      return `Waiting on ${displayText(ctx.who) || 'them'}${when}`;
    case 'open':
      return `Open${when}`;
    default:
      // with_bast, with_sabeen, with_mike, with_<name>
      return `With ${displayText(ctx.who) || state.replace(/^with_/, '')}${when}`;
  }
}

/** One line per attached source on a card or drawer: `Email: Ashlei, Nov 5: Hosting move`. */
export function attachedItemLabel(kind: string, label: string | null, at: Date, zone?: string): string {
  const head: Record<string, string> = { email: 'Email', session: 'Session', send: 'Sent', deploy: 'Deploy', commit: 'Commit', calendar: 'Meeting', wait: 'Wait', folder: 'Folder' };
  const text = displayText(label ?? '') || 'No title';
  return `${head[kind] ?? 'Item'}: ${shortDate(at, zone)}: ${text}`;
}
