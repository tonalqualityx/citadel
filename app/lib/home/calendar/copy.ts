/**
 * Home screen Slice 10a: every string on the calendar strip and the meeting drawer. Plain
 * words, no em or en dash, none of the banned words. Event titles and names are untrusted and
 * pass through displayText (a dash becomes a comma).
 */

import { displayText } from '../copy';
import { CAL } from './rules';

export const GROUP_HEADING = 'On your calendar';
export const NOW_WORD = 'Now';
export const LOADING_TEXT = 'Loading.';
export const LOAD_FAILED_TEXT = 'The meeting did not load. Nothing was changed.';
export const RETRY_LABEL = 'Try again';
export const WITH_HEADING = 'With';
export const BEFORE_HEADING = 'Before the call';
export const ITEMS_HEADING = 'Your items';
export const LINKS_HEADING = 'Links';
export const INVITE_HEADING = 'From the invite';
export const NO_MATCH_TEXT = 'No client or lead matched this meeting.';

/** Strips anything that could read as an address from a name or title, then swaps dashes for commas. */
export function safeText(text: string | null | undefined): string {
  return displayText(text)
    .replace(/[^\s@]+@[^\s@]+/g, '')
    .replace(/@/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const earlierText = (n: number): string => `${n} earlier today`;
export const laterText = (n: number): string => `${n} more later today`;

/** "Morgan", "Morgan and Dan", "Morgan, Dan and 2 more". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** "All day: Home" or "All day: Home, Veterans Day and 1 more". */
export function allDayLine(titles: string[]): string | null {
  const t = titles.map(safeText).filter(Boolean);
  if (t.length === 0) return null;
  if (t.length === 1) return `All day: ${t[0]}`;
  if (t.length === 2) return `All day: ${t[0]} and ${t[1]}`;
  return `All day: ${t[0]}, ${t[1]} and ${t.length - 2} more`;
}

export const answerLabel = (name: string | null): string => (name ? `Your time to answer ${name}` : 'Your time to answer a message');
export const untilText = (clock: string): string => `until ${clock}`;
export const tomorrowTime = (clock: string): string => `Tomorrow ${clock}`;

export const holdsReply = (who: string, subject: string): string => `You owe ${who} a reply: ${subject}.`;
export const sessionQuestions = (n: number, title: string | null): string =>
  `Decide before the call: ${n} ${n === 1 ? 'question' : 'questions'} from ${title ? `the ${title} session` : 'a Bast session'}.`;
export const signOffWaits = (project: string): string => `A sign-off waits on you for ${project}.`;
export const needsYouNow = (title: string): string => `Needs you now: ${title}.`;
export const setAsideReply = (who: string, until: string | null): string =>
  `You set aside a reply to ${who}${until ? ` until ${until}` : ''}.`;

export const matchedByAsk = 'Matched by the email that set up this meeting.';
export const matchedByTitle = 'Matched by the meeting title.';
export const matchedByContact = (names: string): string => `Matched by the email address of ${names}.`;
export const matchedByLead = (name: string): string => `Matched by the email address of ${name}, a lead.`;
export const matchedByDomain = (names: string): string => `Matched by the company web address in the email of ${names}.`;

export const lastEmailLabel = (day: string, from: string, subject: string): string => `Last email: ${day}, ${from}: ${subject}`;
export const openClientLabel = (name: string): string => `Open ${name}`;
export const dealLabel = (name: string): string => `The deal: ${name}`;
export const notesLabel = (day: string): string => `Notes from the last meeting, ${day}`;
export const monthlyReportLabel = (month: string): string => `Monthly report, ${month}`;
export const DRIVE_LABEL = 'Drive folder';
export const OPEN_THREAD_LABEL = 'Open the thread';

const HTML_BLOCK = /<\/?(br|p|div|li|ul|ol|tr|td|h[1-6])\b[^>]*>/gi;

/** The invite description as plain text: tags removed, six entities decoded, whitespace collapsed, cut on a word. Null when empty. */
export function inviteText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.replace(HTML_BLOCK, ' ').replace(/<[^>]*>/g, '');
  const decoded = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
  const text = displayText(decoded.replace(/\s+/g, ' ').trim());
  if (!text) return null;
  if (text.length <= CAL.inviteChars) return text;
  const cut = text.slice(0, CAL.inviteChars);
  const at = cut.lastIndexOf(' ');
  return (at > CAL.inviteChars / 2 ? cut.slice(0, at) : cut).trim();
}
