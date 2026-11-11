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

export interface SummarySaveResult {
  dry_run: false;
  skipped_all?: 'home_off';
  saved: number;
  refused: { item_key: string; reason: RefusalReason }[];
  skipped: { item_key: string; reason: SkipReason }[];
  action_id: string | null;
  line: string | null;
}

/** Longest done_when: lines and words per line. */
export const DONE_WHEN_MAX_LINES = 8;
export const DONE_WHEN_MAX_WORDS = 25;

const DASH_RE = new RegExp('[' + [0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCharCode(c)).join('') + ']|\\s-{1,2}\\s|--');
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
  const empty: SummarySaveResult = { dry_run: false, saved: 0, refused: [], skipped: [], action_id: null, line: null };
  const { ok } = await ownerOnHome(db, ownerId);
  if (!ok) return { ...empty, skipped_all: 'home_off' };

  const refused: SummarySaveResult['refused'] = [];
  const skipped: SummarySaveResult['skipped'] = [];

  // 1. Shape and wording, per item.
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
    const summary = it.summary.replace(/\s+/g, ' ').trim();
    const why = textRefusal(summary, SUMMARY.maxWords);
    if (why) {
      refused.push({ item_key: it.item_key, reason: why });
      continue;
    }
    const lines = (it.done_when ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
    if (lines.length > DONE_WHEN_MAX_LINES || lines.some((l) => textRefusal(l, DONE_WHEN_MAX_WORDS) !== null)) {
      refused.push({ item_key: it.item_key, reason: 'bad_done_when' });
      continue;
    }
    valid.push({ item_key: it.item_key, task_id: parsed.id, hash: it.hash, summary, checklist: lines });
  }

  if (valid.length === 0) return { ...empty, refused, skipped };

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

      if (after.length === 0) return { ...empty, refused, skipped };
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
      return { dry_run: false, saved: after.length, refused, skipped, action_id: action.id, line };
    },
    { timeout: 30_000 },
  );
}
