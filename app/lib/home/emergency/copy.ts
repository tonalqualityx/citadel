/**
 * Home screen Slice 6a: every reader-facing string for the "Not an emergency" rules, the site down rows and the
 * Monday hands row. Same laws as ../copy.ts: plain words, no em or en dash, never the words for a ranking label or a
 * missed deadline, elapsed time in words. Stored text (a domain, a client name, a reason) goes through displayText.
 *
 * Pure: no I/O, no Prisma.
 */

import { displayText } from '../copy';

// ---- Rules ----

/** The refusal for a task emergency (security, lifeline, job watch, client blocking, hard date). */
export const SECURITY_NEVER_RULE = 'A security flag is never turned into a rule.';
export const RULE_NOT_FOR_ITEM = 'This kind of item cannot be turned into a rule.';
export const RULE_SCOPE_NOT_OFFERED = 'That choice is not offered for this item.';
export const RULE_DOMAIN_REFUSED = 'A rule for everyone at that domain is not offered for free mail or our own domains.';
export const RULE_SENDER_REFUSED = 'A rule for our own address is not offered.';
export const RULE_ITEM_NOT_FOUND = 'That item is not here anymore.';
export const RULE_UNDO_EXPIRED = 'The seven days to undo this rule have passed.';
export const RULE_UNDO_CHANGED = 'This rule was changed since, so it was left alone.';
export const RULE_UNDO_USED = 'This was already undone.';
export const RULE_ASK_TITLE = 'Why? This becomes a rule.';
export const RULE_SAVE_LABEL = 'Save rule';
export const RULE_UNDO_LABEL = 'Undo';
export const RULE_DEFAULT_TEXT = 'Saved from the home screen.';
export const RULE_REASON_MAX = 300;
/** The home_actions.action of a saved rule (its Undo is its own route code, never the generic one). */
export const RULE_ACTION = 'not_emergency_rule';

export function scopeLabelSender(address: string): string {
  return `Mail from ${displayText(address)}`;
}
export function scopeLabelDomain(domain: string): string {
  return `Mail from anyone at ${displayText(domain)}`;
}
export function scopeLabelSite(domain: string): string {
  return `${displayText(domain)} going down`;
}

/** The rule in plain words, for the Decision title and the Handled line. */
export function ruleSentence(kind: 'sender' | 'domain' | 'site', value: string): string {
  const v = displayText(value);
  if (kind === 'sender') return `mail from ${v} is not an emergency`;
  if (kind === 'domain') return `mail from anyone at ${v} is not an emergency`;
  return `${v} going down is not an emergency`;
}

export function ruleDecisionTitle(kind: 'sender' | 'domain' | 'site', value: string): string {
  return `Not an emergency: ${ruleSentence(kind, value)}`;
}

/** The Handled for you line after saving. */
export function ruleSavedLine(kind: 'sender' | 'domain' | 'site', value: string): string {
  return `Saved a rule: ${ruleSentence(kind, value)}.`;
}

export const RULE_SAVED_MESSAGE = 'Saved. It will not come back as an emergency.';

// ---- Site down ----

export function siteDownTitle(domain: string): string {
  return `${displayText(domain)} is down.`;
}

export function minutesWord(minutes: number): string {
  const m = Math.floor(minutes);
  if (m < 1) return 'less than a minute';
  if (m < 120) return m === 1 ? '1 minute' : `${m} minutes`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hours`;
  return `${Math.floor(h / 24)} days`;
}

/** "Jill's Cafe · down 35 minutes · checked again 3 minutes ago" (the client part is left out when unknown). */
export function siteDownDetail(ctx: {
  client: string | null;
  downMinutes: number;
  checkedAgoMinutes: number | null;
}): string {
  const parts: string[] = [];
  if (ctx.client) parts.push(displayText(ctx.client));
  parts.push(`down ${minutesWord(ctx.downMinutes)}`);
  if (ctx.checkedAgoMinutes !== null) {
    parts.push(
      ctx.checkedAgoMinutes < 1 ? 'checked again just now' : `checked again ${minutesWord(ctx.checkedAgoMinutes)} ago`
    );
  }
  return parts.join(' · ');
}

export const SITE_KUMA_IF_IGNORED =
  'The watchdog already told you on Slack and keeps checking every 2 minutes. This row clears when the site answers.';
export const SITE_MAIL_IF_IGNORED = 'Bast checks the site again every 5 minutes. This row clears when the site answers.';

/** Shown when the check found the site up: "jillscafe.com answers again (checked 10:42)." */
export function siteAnswersAgainMailLine(domain: string, checkedAt: Date, timeZone: string): string {
  const hhmm = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: false })
    .format(checkedAt)
    .replace(/^24:/, '00:');
  return `${displayText(domain)} answers again (checked ${hhmm}).`;
}

/** "jillscafe.com answers again. It was down 23 minutes." */
export function siteClearedLine(domain: string, downMinutes: number): string {
  return `${displayText(domain)} answers again. It was down ${minutesWord(downMinutes)}.`;
}

/** The card's first lines for a site down row. */
export function siteSummary(source: 'kuma' | 'uptime_mail', domain: string): string {
  const d = displayText(domain);
  return source === 'kuma'
    ? `${d} is not answering. The watchdog confirmed it more than 10 minutes ago.`
    : `${d} is not answering. Bast checked the site itself after an urgent email named it.`;
}
export const SITE_RULED_CHECK = 'Marked not an emergency. It clears when the site answers.';

export const SITE_ACTION_DOWN = 'watch_site_down';
export const SITE_ACTION_CLEARED = 'watch_site_cleared';

// ---- Hands ----

export const HANDS_NO_SOP_LABEL = 'No written steps';
export const HANDS_NOT_THIS_WEEK_LABEL = 'Not this week';
export const HANDS_WHY_NOW = 'These jobs need hands on a screen. They come up once a week instead of one by one.';
export const HANDS_REASON = 'Jobs tagged for hands wait for one weekly sitting, so they are not listed one by one.';
export const HANDS_SUMMARY = 'Open this row to see each job, grouped by its written steps.';
export const HANDS_PARKED_MESSAGE = 'Back next Monday.';
export const HANDS_IF_IGNORED = 'Stays here Monday to Friday until the jobs are done or you park it. Nothing happens on its own.';

export function handsTitle(count: number, minutes: number): string {
  const jobs = count === 1 ? '1 job' : `${count} jobs`;
  return `This week's hands: ${jobs}, about ${minutes} minutes in all.`;
}
