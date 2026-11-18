/**
 * Slice 2b: card summaries written by Bast. Citadel makes no model call. The machine reads the long descriptions
 * (listSummaryWork), writes a short version of each, and sends them back (saveSummaries).
 *
 * Writes only the owner's home_item_state card fields and one home_actions row with source 'keeper' (undo window 72
 * hours, through the same keeper Undo as the other lines). Never a Task, Arc, EmailAsk, Wait, Comment or Notification.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { CLOSED_TASK_STATUSES, KEEPER, SUMMARY } from '../rules';
import { displayText } from '../copy';
import { loadHomeInputs } from '../load';
import { appendHomeAction, loadItemStates } from '../state';
import { selectHome, rankCompare } from '../select';
import { parseItemKey, taskKey } from '../item-key';
import { toPlainText } from '../plain-text';
import { descriptionHash } from '../summary-hash';
import { ownerOnHome } from './run';
import { DETAIL_CAP } from './lines';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';

const HOUR_MS = 3_600_000;

/** One long card the machine should write a short version of. */
export interface SummaryWorkItem {
  item_key: string;
  task_id: string;
  title: string;
  /** The description as plain text, cut to SUMMARY.maxInputChars. */
  text: string;
  /** sha256 of the stored description; send it back unchanged. */
  hash: string;
  /** The task already has a checklist of its own (no done_when is needed). */
  has_checklist: boolean;
}

/** An item the machine sent. */
export interface SummaryInput {
  item_key: string;
  hash: string;
  summary: string;
  done_when?: string[];
}

export type RefusalReason = 'empty' | 'too_long' | 'dash' | 'banned_word' | 'bad_done_when';
export type SkipReason = 'duplicate' | 'not_found' | 'not_long' | 'stale_hash' | 'held' | 'unchanged' | 'changed';

/** What the repair step changed in a piece of text. */
export type RepairNote = 'dash' | 'banned_word' | 'too_long';

export interface SummarySaveResult {
  dry_run: false;
  skipped_all?: 'home_off';
  saved: number;
  refused: { item_key: string; reason: RefusalReason }[];
  /** Cards whose text was repaired (a dash, a banned word or a length fix) and kept. Counted over every item sent. */
  repaired: number;
  /** Checklist lines (or summary sentences) dropped because they could not be repaired; the card was kept. */
  dropped_lines: number;
  /** One row per card that had anything repaired or dropped, so the nightly log can say what happened. */
  repairs: { item_key: string; fixed: RepairNote[]; dropped_lines: number }[];
  skipped: { item_key: string; reason: SkipReason }[];
  action_id: string | null;
  line: string | null;
}

/**
 * Longest done_when: lines and words per line. NOT a source of truth. The limits and the repair rules are defined in
 * ~/.claude/tools/home-keeper/summarize.py (SUMMARY_MAX_WORDS, DONE_WHEN_MAX_LINES, DONE_WHEN_MAX_WORDS), which repairs
 * text before it is posted. These values only mirror that file so this last-resort repair never saves anything it
 * would not. Do not define or change limits here: change summarize.py and mirror the numbers.
 */
export const DONE_WHEN_MAX_LINES = 6;
export const DONE_WHEN_MAX_WORDS = 14;

const DASH_CHARS = [0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCharCode(c)).join('');
// A dash is a figure/en/em/horizontal-bar/minus character, a hyphen run with space on both sides (or at an end of the
// text), or a double hyphen between two word characters. A hyphen inside a word (sign-in) and a flag (--force) are not.
const DASH_RE = new RegExp('[' + DASH_CHARS + ']|(?:^|\\s)-+(?:\\s|$)|\\w-{2,}\\w');
const DASH_TOKEN_RE = new RegExp('\\s*[' + DASH_CHARS + ']\\s*|(?:^|\\s+)-+(?:\\s+|$)|(?<=\\w)-{2,}(?=\\w)', 'g');
const MINUS_NUMBER_RE = new RegExp('(^|\\s)\\u2212(?=\\d)', 'g');
const BANNED_RE = /\b(priority|priorities|overdue)\b/i;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Why one line of text may not go on Mike's screen, or null. */
export function textRefusal(text: string, maxWords: number): RefusalReason | null {
  if (text.trim() === '') return 'empty';
  if (words(text) > maxWords) return 'too_long';
  if (DASH_RE.test(text)) return 'dash';
  if (BANNED_RE.test(text)) return 'banned_word';
  return null;
}

const sentencesOf = (s: string): string[] => s.split(/(?<=[.!?])\s+/).filter((p) => p.trim() !== '');

/** Dashes used as punctuation become a comma or a full stop. Hyphens inside words are left alone. */
function repairDashes(input: string): string {
  const s = input.replace(MINUS_NUMBER_RE, '$1minus ');
  const out = s.replace(DASH_TOKEN_RE, (match, offset: number) => {
    const before = s.slice(0, offset);
    const after = s.slice(offset + match.length);
    if (before.trim() === '' || after.trim() === '') return '';
    if (/^[.,;:!?)]/.test(after)) return '';
    if (/[.,;:!?]$/.test(before)) return ' ';
    const lastSentence = before.split(/[.!?]\s+/).pop() ?? '';
    const nextSentence = after.split(/[.!?]/)[0] ?? '';
    const full = /^[A-Z]/.test(after) && words(lastSentence) >= 3 && words(nextSentence) >= 3;
    return full ? '. ' : ', ';
  });
  return out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const keepCase = (from: string, to: string): string => (/^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** Rewrite the banned words where a plain swap reads correctly. Anything else is left for the caller to drop. */
function rewriteBanned(s: string): string {
  const article = '(a|an|the|our|his|her|their|my|your|its|these|those)';
  return s
    .replace(/\b(top|highest|first)[- ]priority\b/gi, (m) => keepCase(m, 'most important'))
    .replace(/\bhigh[- ]priority\b/gi, (m) => keepCase(m, 'important'))
    .replace(/\blow[- ]priority\b/gi, (m) => keepCase(m, 'minor'))
    .replace(/\boverdue\b/gi, (m) => keepCase(m, 'late'))
    .replace(new RegExp('\\b' + article + ' priorities\\b', 'gi'), (_m, a: string) => `${a} key items`)
    .replace(new RegExp('\\b' + article + ' priority\\b', 'gi'), (_m, a: string) => `${a} key item`);
}

/** Cut to at most maxWords at a sentence boundary, else at a clause boundary of the first sentence. Null when neither fits. */
function trimToWords(s: string, maxWords: number): string | null {
  if (words(s) <= maxWords) return s;
  const sentences = sentencesOf(s);
  let out = '';
  for (const sent of sentences) {
    const cand = out ? `${out} ${sent}` : sent;
    if (words(cand) > maxWords) break;
    out = cand;
  }
  if (out) return out;
  const clauses = (sentences[0] ?? '').split(/(?<=[,;:])\s+/);
  let acc = '';
  for (const c of clauses) {
    const cand = acc ? `${acc} ${c}` : c;
    if (words(cand) > maxWords) break;
    acc = cand;
  }
  acc = acc.replace(/[,;:]+$/, '').trim();
  if (acc === '' || acc === (sentences[0] ?? '')) return null;
  return /[.!?]$/.test(acc) ? acc : `${acc}.`;
}

export interface RepairResult {
  /** The repaired text, or null when it could not be repaired. */
  text: string | null;
  fixed: RepairNote[];
  /** Why it could not be repaired (only when text is null). */
  refusal: RefusalReason | null;
}

/**
 * Repair one piece of text so it passes textRefusal: dashes first, then banned words, then length, then a re-check.
 * Empty text is not repairable. A banned word that no plain swap fixes drops its sentence when `dropSentences` is set
 * (a summary), otherwise the text is not repairable (a checklist line, which the caller drops).
 */
export function repairText(input: string, maxWords: number, opts: { dropSentences?: boolean } = {}): RepairResult {
  let s = input.replace(/\s+/g, ' ').trim();
  if (s === '') return { text: null, fixed: [], refusal: 'empty' };
  const fixed: RepairNote[] = [];
  if (DASH_RE.test(s)) {
    s = repairDashes(s);
    fixed.push('dash');
  }
  if (BANNED_RE.test(s)) {
    s = rewriteBanned(s);
    if (BANNED_RE.test(s) && opts.dropSentences) s = sentencesOf(s).filter((x) => !BANNED_RE.test(x)).join(' ');
    if (BANNED_RE.test(s)) return { text: null, fixed, refusal: 'banned_word' };
    fixed.push('banned_word');
  }
  if (s === '') return { text: null, fixed, refusal: 'banned_word' };
  if (words(s) > maxWords) {
    const t = trimToWords(s, maxWords);
    if (t === null) return { text: null, fixed, refusal: 'too_long' };
    s = t;
    fixed.push('too_long');
  }
  const why = textRefusal(s, maxWords);
  if (why) return { text: null, fixed, refusal: why };
  return { text: s, fixed, refusal: null };
}

export interface PreparedItem {
  /** The repaired summary, or null when the summary cannot be repaired (the whole card is refused). */
  summary: string | null;
  refusal: RefusalReason | null;
  /** The checklist lines that survived repair, in order. */
  checklist: string[];
  fixed: RepairNote[];
  dropped_lines: number;
}

/** Repair a summary and its checklist. A bad checklist line is dropped on its own; the card is refused only for its summary. */
export function prepareItem(summaryIn: string, doneWhen: string[] | undefined): PreparedItem {
  const fixedHere = new Set<RepairNote>();
  const s = repairText(summaryIn, SUMMARY.maxWords, { dropSentences: true });
  if (s.text === null) return { summary: null, refusal: s.refusal ?? 'empty', checklist: [], fixed: [], dropped_lines: 0 };
  s.fixed.forEach((n) => fixedHere.add(n));
  const raw = (doneWhen ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
  let dropped = Math.max(0, raw.length - DONE_WHEN_MAX_LINES);
  const checklist: string[] = [];
  for (const l of raw.slice(0, DONE_WHEN_MAX_LINES)) {
    const r = repairText(l, DONE_WHEN_MAX_WORDS);
    if (r.text === null) {
      dropped += 1;
      continue;
    }
    r.fixed.forEach((n) => fixedHere.add(n));
    checklist.push(r.text);
  }
  return { summary: s.text, refusal: null, checklist, fixed: [...fixedHere], dropped_lines: dropped };
}

/** The quiet line for n short versions written. */
export function summariesLine(n: number): string {
  const what = n === 1 ? 'Wrote a short version of 1 long card.' : `Wrote short versions of ${n} long cards.`;
  return `${what} The full notes stay one click away.`;
}

/** The owner's long cards that still need a short version: in view first, then by rank. */
export async function listSummaryWork(db: PrismaClient, ownerId: string, now: Date, limit: number): Promise<{ skipped?: 'home_off'; items: SummaryWorkItem[] }> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', items: [] };
  const cap = Math.max(1, Math.min(SUMMARY.perRun, Math.floor(limit) || SUMMARY.perRun));
  const [raw, states] = await Promise.all([
    loadHomeInputs(db, ownerId, now, { timezone: timezone || DEFAULT_DISPLAY_TIMEZONE }),
    loadItemStates(db, ownerId),
  ]);
  const stateByKey = new Map(states.map((s) => [s.item_key, s]));
  const sel = selectHome({ raw, states, now });
  const inView = new Set([...sel.sections.needs_you_now, ...sel.sections.working_on, ...sel.sections.next].map((i) => i.key));
  const rank = new Map([...sel.candidates].sort(rankCompare).map((c, i) => [c.key, i]));

  const work: { item: SummaryWorkItem; view: boolean; rank: number }[] = [];
  for (const t of raw.tasks) {
    if (t.bot_task || !t.description) continue;
    const key = taskKey(t.id);
    const st = stateByKey.get(key);
    if (st?.keeper_hold_until && st.keeper_hold_until.getTime() > now.getTime()) continue;
    const hash = descriptionHash(t.description);
    if (!hash || st?.card_summary_hash === hash) continue;
    const plain = toPlainText(t.description);
    if (words(plain) <= SUMMARY.minWords) continue;
    work.push({
      item: {
        item_key: key,
        task_id: t.id,
        title: displayText(t.title) || 'Untitled task',
        text: plain.slice(0, SUMMARY.maxInputChars),
        hash,
        has_checklist: t.requirements.length > 0,
      },
      view: inView.has(key),
      rank: rank.get(key) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  work.sort((a, b) => Number(b.view) - Number(a.view) || a.rank - b.rank || (a.item.item_key < b.item.item_key ? -1 : 1));
  return { items: work.slice(0, cap).map((w) => w.item) };
}

interface Rec {
  item_key: string;
  existed: boolean;
  fields: Record<string, unknown>;
}

/** Save the machine's short versions for the owner. Refusals and skips are listed; everything valid is saved. */
export async function saveSummaries(db: PrismaClient, ownerId: string, now: Date, input: SummaryInput[]): Promise<SummarySaveResult> {
  const empty: SummarySaveResult = { dry_run: false, saved: 0, refused: [], repaired: 0, dropped_lines: 0, repairs: [], skipped: [], action_id: null, line: null };
  const { ok } = await ownerOnHome(db, ownerId);
  if (!ok) return { ...empty, skipped_all: 'home_off' };

  const refused: SummarySaveResult['refused'] = [];
  const skipped: SummarySaveResult['skipped'] = [];
  const repairs: SummarySaveResult['repairs'] = [];
  let repairedCards = 0;
  let droppedLines = 0;

  // 1. Shape and wording, per item. Text that breaks a writing rule is repaired; a bad checklist line is dropped on its
  // own. Only a summary that cannot be repaired (empty, or no way to fix it) refuses the card.
  const seen = new Set<string>();
  const valid: { item_key: string; task_id: string; hash: string; summary: string; checklist: string[] }[] = [];
  for (const it of input) {
    const parsed = parseItemKey(it.item_key);
    if (seen.has(it.item_key)) {
      skipped.push({ item_key: it.item_key, reason: 'duplicate' });
      continue;
    }
    seen.add(it.item_key);
    if (!parsed || parsed.kind !== 'task') {
      skipped.push({ item_key: it.item_key, reason: 'not_found' });
      continue;
    }
    const prep = prepareItem(it.summary, it.done_when);
    if (prep.summary === null) {
      refused.push({ item_key: it.item_key, reason: prep.refusal ?? 'empty' });
      continue;
    }
    const summary = prep.summary;
    const lines = prep.checklist;
    if (prep.fixed.length > 0) repairedCards += 1;
    droppedLines += prep.dropped_lines;
    if (prep.fixed.length > 0 || prep.dropped_lines > 0) repairs.push({ item_key: it.item_key, fixed: prep.fixed, dropped_lines: prep.dropped_lines });
    valid.push({ item_key: it.item_key, task_id: parsed.id, hash: it.hash, summary, checklist: lines });
  }

  const counts = () => ({ repaired: repairedCards, dropped_lines: droppedLines, repairs });
  if (valid.length === 0) return { ...empty, refused, skipped, ...counts() };

  // 2. The owner's own open tasks only (a bot task or anyone else's id is not found).
  const tasks = await db.task.findMany({
    where: { id: { in: valid.map((v) => v.task_id) }, assignee_id: ownerId, is_deleted: false, status: { notIn: [...CLOSED_TASK_STATUSES] } },
    select: { id: true, title: true, description: true, requirements: true },
  });
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const undoUntil = new Date(now.getTime() + KEEPER.undoHours * HOUR_MS);
  return db.$transaction(
    async (tx): Promise<SummarySaveResult> => {
      const before: Rec[] = [];
      const after: Rec[] = [];
      const details: string[] = [];
      for (const v of valid) {
        const task = taskById.get(v.task_id);
        if (!task || !task.description) {
          skipped.push({ item_key: v.item_key, reason: 'not_found' });
          continue;
        }
        const current = descriptionHash(task.description);
        if (current !== v.hash) {
          skipped.push({ item_key: v.item_key, reason: 'stale_hash' });
          continue;
        }
        if (words(toPlainText(task.description)) <= SUMMARY.minWords) {
          skipped.push({ item_key: v.item_key, reason: 'not_long' });
          continue;
        }
        const st = await tx.homeItemState.findUnique({
          where: { user_id_item_key: { user_id: ownerId, item_key: v.item_key } },
          select: { keeper_hold_until: true, card_summary: true, card_checklist: true, card_summary_hash: true },
        });
        if (st?.keeper_hold_until && st.keeper_hold_until.getTime() > now.getTime()) {
          skipped.push({ item_key: v.item_key, reason: 'held' });
          continue;
        }
        if (st?.card_summary_hash === current) {
          skipped.push({ item_key: v.item_key, reason: 'unchanged' });
          continue;
        }
        const ownList = Array.isArray(task.requirements) && task.requirements.length > 0;
        const checklist = !ownList && v.checklist.length >= 2 ? v.checklist : null;
        const data = {
          card_summary: v.summary,
          card_checklist: checklist === null ? Prisma.DbNull : (checklist as Prisma.InputJsonValue),
          card_summary_hash: current,
          card_summary_at: now,
        };
        let applied = false;
        if (st) {
          const r = await tx.homeItemState.updateMany({
            where: {
              user_id: ownerId,
              item_key: v.item_key,
              card_summary_hash: st.card_summary_hash,
              OR: [{ keeper_hold_until: null }, { keeper_hold_until: { lte: now } }],
            },
            data,
          });
          applied = r.count === 1;
        } else {
          const r = await tx.homeItemState.createMany({ data: [{ user_id: ownerId, item_key: v.item_key, ...data }], skipDuplicates: true });
          applied = r.count === 1;
        }
        if (!applied) {
          skipped.push({ item_key: v.item_key, reason: 'changed' });
          continue;
        }
        before.push({ item_key: v.item_key, existed: !!st, fields: { card_summary: st?.card_summary ?? null, card_checklist: st?.card_checklist ?? null } });
        after.push({ item_key: v.item_key, existed: true, fields: { card_summary: v.summary, card_checklist: checklist } });
        details.push(`${displayText(task.title) || 'Untitled task'}: short version written`);
      }

      if (after.length === 0) return { ...empty, refused, skipped, ...counts() };
      const line = summariesLine(after.length);
      const capped = details.length > DETAIL_CAP ? [...details.slice(0, DETAIL_CAP), `and ${details.length - DETAIL_CAP} more`] : details;
      const action = await appendHomeAction(tx, ownerId, {
        item_key: null,
        action: 'keeper_summaries',
        source: 'keeper',
        before: { states: before },
        after: { states: after, line, details: capped },
        undo_until: undoUntil,
      });
      return { dry_run: false, saved: after.length, refused, skipped, ...counts(), action_id: action.id, line };
    },
    { timeout: 30_000 },
  );
}
