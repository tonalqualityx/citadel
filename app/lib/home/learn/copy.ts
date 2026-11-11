/**
 * Slice 7a: the plain sentences for the weekly measures line and the approval-speed guard, and the constants they use.
 * Pure. No dashes, and none of the words the screen never uses (copy-guard covers lib/home).
 */

import { displayText } from '../copy';
import type { GuardResult, WeekMeasures } from './measures';

export const LEARN = {
  /** A sentence needs this many business days of data in its week. */
  minBusinessDays: 5,
  /** The guard needs this many first actions on sign-offs and approvals in one week. */
  guardRows: 20,
  /** ...more than this share of them approvals... */
  guardShare: 0.95,
  /** ...and a median gap since his previous tap under this. */
  guardGapMs: 5000,
  /** An emergency should be seen within this many working hours. */
  emergencyHours: 4,
  /** A reply that waited over this many business days is listed. */
  owedDays: 3,
} as const;

/** The home_actions.action values this slice writes (source keeper, no Undo). */
export const MEASURES_ACTION = 'keeper_measures';
export const GUARD_ACTION = 'keeper_guard';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const BANNED_RE = /\b(priority|priorities|overdue)\b/i;
const DASH_RE = new RegExp('[' + [0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCharCode(c)).join('') + ']|\\s-{1,2}\\s|--');

const BANNED_ALL_RE = /\b(priority|priorities|overdue)\b/gi;

/** A name taken from his data (a subject, a client) made safe for his screen: no dash, none of the banned words, cut short. */
export function cleanLabel(text: string | null | undefined, max = 80): string {
  const t = displayText(text).replace(BANNED_ALL_RE, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

/** True when a sentence could go on his screen: no dash, none of the banned words. */
export function lineIsClean(text: string): boolean {
  return !DASH_RE.test(text) && !BANNED_RE.test(text);
}

/** Hours as a short number: 1.5 stays 1.5, 2 stays 2. */
export function hoursText(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function emergencySentence(v: WeekMeasures['emergencies']['value']): string {
  if (v.total === 0) return 'No emergencies.';
  const target = `${LEARN.emergencyHours} working hours`;
  const head = plural(v.total, 'emergency', 'emergencies');
  if (v.seen_in_time === v.total) return `${head}, ${v.total === 1 ? 'seen' : 'all seen'} within ${target}.`;
  if (v.seen_in_time === 0) return `${head}, ${v.total === 1 ? 'not' : 'none'} seen within ${target}.`;
  return `${head}, ${v.seen_in_time} seen within ${target}.`;
}

export function owedSentence(count: number): string {
  if (count === 0) return `No replies waited over ${LEARN.owedDays} business days.`;
  return `${plural(count, 'reply', 'replies')} waited over ${LEARN.owedDays} business days.`;
}

export function whereSentence(v: WeekMeasures['where']['value']): string {
  return `${v.here} of ${v.total} task changes were made here.`;
}

export function plateSentence(v: WeekMeasures['plate']['value']): string {
  const past = v.past_day === 0 ? 'none past their day' : `${v.past_day} past their day`;
  return `${plural(v.open, 'open item', 'open items')}, ${past}.`;
}

/** The Monday line: "Last week: ..." with every sentence whose measure has enough data. Null when none has. */
export function weekLine(week: WeekMeasures): { text: string; details: string[] } | null {
  const sentences: string[] = [];
  const details: string[] = [];
  const add = (ok: boolean, sentence: string, more: string[]) => {
    if (!ok) return;
    sentences.push(sentence);
    details.push(...more);
  };
  add(week.emergencies.ok, emergencySentence(week.emergencies.value), week.emergencies.details);
  add(week.owed.ok, owedSentence(week.owed.value.count), week.owed.details);
  add(week.where.ok, whereSentence(week.where.value), week.where.details);
  add(week.plate.ok, plateSentence(week.plate.value), week.plate.details);
  if (sentences.length === 0) return null;
  if (week.today.ok) details.push(...week.today.details);
  const text = `Last week: ${sentences.join(' ')}`;
  return { text, details: details.map((d) => displayText(d)) };
}

/** The guard line for a result that fired. */
export function guardLine(g: GuardResult): string {
  const secs = LEARN.guardGapMs / 1000;
  return `You approved ${g.approvals} of ${g.rows} sign-offs and approvals last week, most within ${secs} seconds of your tap before. If these do not need you, tell Bast and it will suggest asking less.`;
}

// ============================================================================
// Slice 7b: Learned lines, the card footer sentence and the settings text. Sentences only: no number from a weight.
// ============================================================================

/** The home_actions.action a weight change is written under (source keeper, Undo for 7 days). */
export const LEARNED_ACTION = 'keeper_learned';

export const LEARNED_ORDER_ONLY = 'This changes order only. It never changes what counts as an emergency or a real date.';
export const LEARNED_EMPTY = 'Nothing learned yet. It needs a few weeks of your taps.';
export const LEARNED_SWITCH_LABEL = 'Learn from my taps';
export const LEARNED_SWITCH_HINT = 'When this is off, nothing new is learned. What was learned stays until you put it back.';
export const LEARNED_HEADING = 'What the home screen learned';
export const LEARNED_PUT_BACK = 'Put back';

function evKind(key: string): string {
  return key.split(':', 1)[0];
}

function cap1(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** The subject of a sentence for a piece of evidence, and whether the verb is plural. */
function subject(key: string, label: string): { text: string; plural: boolean } {
  const l = cleanLabel(label, 60);
  switch (evKind(key)) {
    case 'client':
      return { text: `${l} work`, plural: false };
    case 'project':
      return { text: `work on ${l}`, plural: false };
    case 'sender':
      return { text: l, plural: false };
    default:
      return { text: l, plural: true };
  }
}

/** "Learned: Nerd Herd work now comes up a little sooner." */
export function learnedLine(key: string, label: string, dir: 'up' | 'down'): string {
  const s = subject(key, label);
  const verb = s.plural ? 'come' : 'comes';
  return `Learned: ${cap1(s.text)} now ${verb} up a little ${dir === 'up' ? 'sooner' : 'later'}.`;
}

/** The Show lines under a Learned line. */
export function learnedDetails(up: number, down: number): string[] {
  const n = (c: number, one: string, many: string) => (c === 0 ? 'none' : c === 1 ? `1 ${one}` : `${c} ${many}`);
  return [`You moved ${n(up, 'item', 'items')} up and set ${n(down, 'item', 'items')} aside in the last 4 weeks.`, LEARNED_ORDER_ONLY];
}

/** The card footer sentence, after "Why it's here". */
export function learnedFooter(key: string, label: string, dir: 'up' | 'down'): string {
  const s = subject(key, label);
  return dir === 'up'
    ? `Comes up a little sooner because you moved ${s.text} up before.`
    : `Comes up a little later because you set ${s.text} aside before.`;
}

/** One settings line, "Nerd Herd work comes up a little sooner, since November 30". */
export function learnedSettingsSentence(key: string, label: string, weightPct: number, since: string | null): string {
  const s = subject(key, label);
  const verb = s.plural ? 'come' : 'comes';
  const tail = since ? `, since ${since}` : '';
  return `${cap1(s.text)} ${verb} up a little ${weightPct > 100 ? 'sooner' : 'later'}${tail}`;
}
