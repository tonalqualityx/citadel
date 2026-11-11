/**
 * Work stage A: the one-time tidy behind POST /api/work/backfill-links.
 *
 * The machine (work-links/backfill.py) sends what it found, as claims: pairs of (ask, task, basis) and RFC keys for asks.
 * Citadel trusts none of it. planBackfill recomputes every decision from its own data, and the dry run and the real run
 * both call it, so they decide identically (the route's test feeds the same body to both):
 *
 * - A pair stands only when the ask is still open, the task exists and is not deleted, the ask is not already linked to
 *   another task, the ask is not named twice, and the basis holds:
 *     source_ref     the task is email-sourced and its source_ref is this ask's message id;
 *     cross_mailbox  the task's source ask is another copy of this message (same RFC id) or sits in this conversation key;
 *     mint_ledger    the ask shares a conversation with an ask that is the task's source or is linked to it, or the
 *     registry      task's origin_url is the ask's deep link (the machine's ledger and registry are leads, not proof).
 * - A standing pair links the ask. Its ask closes only when the task is done or abandoned AND the ask was received at or
 *   before the task finished (completed_at, else last update). Later asks are listed, not closed. Asks of a
 *   security-tagged task and urgent asks are linked, never closed. A task held after an Undo closes nothing.
 * - Keys (rfc_message_id, conversation_key) are written only over null.
 *
 * Nothing is sent, drafted or changed in any mailbox. The real run writes one Handled line with Undo for 72 hours.
 */

import { z } from 'zod';
import type { HomeDb } from '@/lib/home/state';
import { closeForBackfill, heldTaskIds, homeOwner, isFinishedStatus, isSecurityTagged, type FinishedStatus, type LinkedAskRecord } from './ask-closure';
import { normalizeRfc } from './link-asks';

export const BACKFILL_BASES = ['mint_ledger', 'registry', 'source_ref', 'cross_mailbox'] as const;
export type BackfillBasis = (typeof BACKFILL_BASES)[number];
export const MAX_PAIRS = 500;
export const MAX_KEYS = 1000;
const LIST_CAP = 500;

export const backfillBodySchema = z
  .object({
    dry: z.boolean(),
    pairs: z
      .array(
        z
          .object({
            ask_id: z.string().uuid().optional(),
            message_id: z.string().min(1).max(255).optional(),
            task_id: z.string().uuid(),
            basis: z.enum(BACKFILL_BASES),
          })
          .strict()
          .refine((p) => (p.ask_id === undefined) !== (p.message_id === undefined), { message: 'give ask_id or message_id, not both' }),
      )
      .max(MAX_PAIRS)
      .default([]),
    keys: z
      .array(
        z
          .object({
            ask_id: z.string().uuid(),
            rfc_message_id: z.string().max(255).nullable().optional(),
            conversation_key: z.string().max(255).nullable().optional(),
          })
          .strict(),
      )
      .max(MAX_KEYS)
      .default([]),
  })
  .strict();

export type BackfillBody = z.infer<typeof backfillBodySchema>;

interface AskRow {
  id: string;
  message_id: string;
  account: string;
  thread_id: string | null;
  state: string;
  is_urgent: boolean;
  task_id: string | null;
  received_at: Date;
  rfc_message_id: string | null;
  conversation_key: string | null;
  from_name: string | null;
  from_email: string;
  subject: string;
  deep_link: string;
}

const ASK_SELECT = {
  id: true, message_id: true, account: true, thread_id: true, state: true, is_urgent: true, task_id: true, received_at: true,
  rfc_message_id: true, conversation_key: true, from_name: true, from_email: true, subject: true, deep_link: true,
} as const;

export interface PlannedKey {
  ask_id: string;
  rfc_message_id: string | null;
  conversation_key: string | null;
}

export interface PlannedLink {
  ask: AskRow;
  task: { id: string; title: string; status: string };
  basis: BackfillBasis;
  /** The ask is not linked yet (a real run sets task_id). */
  new_link: boolean;
  outcome: 'open_task' | 'would_close' | 'left_open_after_done' | 'held_security' | 'held_urgent' | 'held_undone';
  finished_at: Date | null;
}

export interface BackfillCounts {
  open_total: number;
  linkable_by_basis: Record<BackfillBasis, number>;
  with_open_task: number;
  would_close: number;
  left_open_after_done: number;
  keys_set: number;
  unmatched: number;
  /** Extra to the plan's counts: linked-never-closed asks and tasks held after an Undo. */
  held_security: number;
  held_urgent: number;
  held_undone: number;
}

export interface BackfillPlan {
  counts: BackfillCounts;
  keys: PlannedKey[];
  links: PlannedLink[];
  unmatched: { ref: string; task_id: string; reason: string }[];
}

function sameConversation(a: AskRow, b: AskRow, eff: (x: AskRow) => { rfc: string | null; conv: string | null }): boolean {
  const ca = eff(a).conv;
  const cb = eff(b).conv;
  if (ca && cb) return ca === cb;
  return !!a.thread_id && a.account === b.account && a.thread_id === b.thread_id;
}

export async function planBackfill(db: HomeDb, body: BackfillBody, now: Date): Promise<BackfillPlan> {
  const askIds = new Set<string>();
  const messageIds = new Set<string>();
  for (const p of body.pairs) {
    if (p.ask_id) askIds.add(p.ask_id);
    else messageIds.add(p.message_id as string);
  }
  for (const k of body.keys) askIds.add(k.ask_id);

  const rows: AskRow[] =
    askIds.size + messageIds.size === 0
      ? []
      : await db.emailAsk.findMany({
          where: { OR: [...(askIds.size ? [{ id: { in: [...askIds] } }] : []), ...(messageIds.size ? [{ message_id: { in: [...messageIds] } }] : [])] },
          select: ASK_SELECT,
        });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byMessage = new Map(rows.map((r) => [r.message_id, r]));

  // Keys: only over null. The first key sent for an ask wins.
  const keys: PlannedKey[] = [];
  const keyOf = new Map<string, PlannedKey>();
  for (const k of body.keys) {
    const ask = byId.get(k.ask_id);
    if (!ask || keyOf.has(k.ask_id)) continue;
    const rfc = ask.rfc_message_id ? null : normalizeRfc(k.rfc_message_id);
    const cv = ask.conversation_key ? null : normalizeRfc(k.conversation_key);
    if (!rfc && !cv) continue;
    const pk = { ask_id: ask.id, rfc_message_id: rfc, conversation_key: cv };
    keyOf.set(ask.id, pk);
    keys.push(pk);
  }
  const eff = (a: AskRow) => ({ rfc: a.rfc_message_id ?? keyOf.get(a.id)?.rfc_message_id ?? null, conv: a.conversation_key ?? keyOf.get(a.id)?.conversation_key ?? null });

  const taskIds = Array.from(new Set(body.pairs.map((p) => p.task_id)));
  const tasks = taskIds.length
    ? await db.task.findMany({
        where: { id: { in: taskIds }, is_deleted: false },
        select: { id: true, title: true, status: true, tags: true, source: true, source_ref: true, origin_url: true, completed_at: true, updated_at: true },
      })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Asks that can show a task's conversation: its source ask, and any ask already linked to it.
  const refs = Array.from(new Set(tasks.filter((t) => t.source === 'email' && t.source_ref).map((t) => t.source_ref as string)));
  const siblings: AskRow[] = tasks.length
    ? await db.emailAsk.findMany({
        where: { OR: [{ task_id: { in: tasks.map((t) => t.id) } }, ...(refs.length ? [{ message_id: { in: refs } }] : [])] },
        select: ASK_SELECT,
      })
    : [];

  const owner = await homeOwner(db);
  const held = await heldTaskIds(db, owner?.id ?? null, tasks.map((t) => t.id), now);

  const counts: BackfillCounts = {
    open_total: await db.emailAsk.count({ where: { state: 'open' } }),
    linkable_by_basis: { mint_ledger: 0, registry: 0, source_ref: 0, cross_mailbox: 0 },
    with_open_task: 0,
    would_close: 0,
    left_open_after_done: 0,
    keys_set: keys.length,
    unmatched: 0,
    held_security: 0,
    held_urgent: 0,
    held_undone: 0,
  };
  const links: PlannedLink[] = [];
  const unmatched: BackfillPlan['unmatched'] = [];
  const used = new Set<string>();

  for (const p of body.pairs) {
    const ref = p.ask_id ?? (p.message_id as string);
    const miss = (reason: string) => {
      counts.unmatched += 1;
      unmatched.push({ ref, task_id: p.task_id, reason });
    };
    const ask = p.ask_id ? byId.get(p.ask_id) : byMessage.get(p.message_id as string);
    if (!ask) { miss('ask_not_found'); continue; }
    if (used.has(ask.id)) { miss('duplicate'); continue; }
    if (ask.state !== 'open') { miss('ask_not_open'); continue; }
    if (ask.task_id && ask.task_id !== p.task_id) { miss('ask_already_linked'); continue; }
    const task = taskById.get(p.task_id);
    if (!task) { miss('task_not_found'); continue; }

    let holds = false;
    if (p.basis === 'source_ref') {
      holds = task.source === 'email' && !!task.source_ref && task.source_ref === ask.message_id;
    } else {
      const source = task.source === 'email' && task.source_ref ? siblings.find((s) => s.message_id === task.source_ref) : undefined;
      if (p.basis === 'cross_mailbox') {
        if (source && source.id !== ask.id) {
          const a = eff(ask);
          const s = eff(source);
          holds = (!!a.rfc && a.rfc === s.rfc) || (!!a.conv && a.conv === s.conv);
        }
      } else {
        holds =
          (!!task.origin_url && task.origin_url === ask.deep_link) ||
          siblings.some((s) => s.id !== ask.id && (s.task_id === task.id || s.message_id === task.source_ref) && sameConversation(ask, s, eff));
      }
    }
    if (!holds) { miss('basis_not_proven'); continue; }

    used.add(ask.id);
    counts.linkable_by_basis[p.basis] += 1;
    const finishedAt = isFinishedStatus(task.status) ? (task.completed_at ?? task.updated_at) : null;
    let outcome: PlannedLink['outcome'];
    if (!finishedAt) outcome = 'open_task';
    else if (isSecurityTagged(task.tags)) outcome = 'held_security';
    else if (ask.is_urgent) outcome = 'held_urgent';
    else if (held.has(task.id)) outcome = 'held_undone';
    else if (ask.received_at.getTime() > finishedAt.getTime()) outcome = 'left_open_after_done';
    else outcome = 'would_close';
    if (outcome === 'open_task') counts.with_open_task += 1;
    else if (outcome === 'would_close') counts.would_close += 1;
    else if (outcome === 'left_open_after_done') counts.left_open_after_done += 1;
    else if (outcome === 'held_security') counts.held_security += 1;
    else if (outcome === 'held_urgent') counts.held_urgent += 1;
    else counts.held_undone += 1;
    links.push({ ask, task: { id: task.id, title: task.title, status: task.status }, basis: p.basis, new_link: !ask.task_id, outcome, finished_at: finishedAt });
  }
  return { counts, keys, links, unmatched };
}

export interface BackfillApplied {
  skipped?: 'home_off';
  keys_set: number;
  linked: number;
  closed: number;
  action_id: string | null;
}

/** Write the plan. Every write is compare-and-set on what the plan saw; one Handled line. Call inside one transaction. */
export async function applyBackfill(tx: HomeDb, plan: BackfillPlan, now: Date): Promise<BackfillApplied> {
  // Owner only: with no home owner on the home view the real run writes nothing (the dry run still answers).
  const owner = await homeOwner(tx);
  if (!owner) return { skipped: 'home_off', keys_set: 0, linked: 0, closed: 0, action_id: null };
  let keysSet = 0;
  for (const k of plan.keys) {
    let changed = false;
    if (k.rfc_message_id) changed = (await tx.emailAsk.updateMany({ where: { id: k.ask_id, rfc_message_id: null }, data: { rfc_message_id: k.rfc_message_id } })).count === 1 || changed;
    if (k.conversation_key) changed = (await tx.emailAsk.updateMany({ where: { id: k.ask_id, conversation_key: null }, data: { conversation_key: k.conversation_key } })).count === 1 || changed;
    if (changed) keysSet += 1;
  }
  const linked: LinkedAskRecord[] = [];
  for (const l of plan.links) {
    if (!l.new_link) continue;
    const r = await tx.emailAsk.updateMany({ where: { id: l.ask.id, task_id: null, state: 'open' }, data: { task_id: l.task.id } });
    if (r.count === 1) linked.push({ id: l.ask.id, task_id: l.task.id, basis: l.basis });
  }
  const closes = plan.links
    .filter((l) => l.outcome === 'would_close')
    .map((l) => ({
      ask: { id: l.ask.id, task_id: l.task.id, from_name: l.ask.from_name, from_email: l.ask.from_email, subject: l.ask.subject, received_at: l.ask.received_at, deep_link: l.ask.deep_link },
      status: l.task.status as FinishedStatus,
      title: l.task.title,
    }));
  const res = await closeForBackfill(tx, owner, { closes, linked }, now);
  return { keys_set: keysSet, linked: linked.length, closed: res.closed.length, action_id: res.action_id };
}

/** The lists the route returns beside the counts (capped). Subjects and dates only; no bodies exist here. */
export function backfillLists(plan: BackfillPlan) {
  const pick = (outcome: PlannedLink['outcome']) =>
    plan.links
      .filter((l) => l.outcome === outcome)
      .slice(0, LIST_CAP)
      .map((l) => ({ ask_id: l.ask.id, task_id: l.task.id, task_title: l.task.title, task_status: l.task.status, ask_subject: l.ask.subject, received_at: l.ask.received_at.toISOString(), basis: l.basis }));
  return {
    would_close: pick('would_close'),
    left_open_after_done: pick('left_open_after_done'),
    held_security: pick('held_security'),
    unmatched: plan.unmatched.slice(0, LIST_CAP),
  };
}
