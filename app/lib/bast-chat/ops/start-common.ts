/**
 * Bast chat, ops `start_project` and `start_quote`: the pieces they share (plan bast-chat-start, Citadel side).
 *
 * Both ops write a kickoff or pricing task that is assigned to the owner, carries no project (the home screen hides
 * tasks of hidden projects, so a project would hide it), and is tagged `from-chat`. The reach check
 * (`checkTaskCreate`) runs on that planned task. Undo never deletes: rows go to `cancelled`, `abandoned` or `lost`,
 * and only while they are still as the chat left them.
 */
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { loadReachTask, type OpContext } from '../actions';
import { cleanLine, quoted } from '../card-context';
import { BAST_USER_ID } from '../gate-mirror';
import { chatChecklist, plainParagraphs, plainString } from '../plain';
import { checkTaskCreate, checkUndo, type ReachOrigin, type ReachResult } from '../worker-reach';
import type { OpDb } from './index';
import { closeAsksForTask } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails

export const CHAT_TAG = 'from-chat';
export const START_CREATED_BY = BAST_USER_ID;
const PLACEHOLDER_TASK_ID = '00000000-0000-4000-8000-000000000000';

/** Free text from the chat: invisible characters out, ends trimmed, kept as the person wrote it otherwise. */
export const freeText = (max: number) => z.string().transform((t) => plainString(t).trim()).pipe(z.string().min(1).max(max));
export const optionalFreeText = (max: number) => z.string().transform((t) => plainString(t).trim()).pipe(z.string().max(max)).optional();

/** Plain paragraphs, exactly as the description column holds them (one per line; blank lines dropped). */
export function paragraphsOf(lines: string[]): string | null {
  return plainParagraphs(lines.flatMap((l) => plainString(l).split('\n')), 'start');
}

/** The checklist as the requirements column holds it. `seed` is the task id, so ids are stable. */
export function checklistOf(items: string[], seed: string): unknown {
  return chatChecklist(items, null, `${seed}:requirements`);
}

/** "November 10, 2026" in the owner's zone. */
export function dateWords(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

/** Where a project's pages are, for the kickoff task's description. */
export function projectLink(id: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com').replace(/\/+$/, '')}/projects/${id}`;
}

/** The Gmail link the email cards use. */
export function threadLink(account: string, threadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(threadId)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The site of a project: the one named (an id, or a name among the client's sites), else the client's only site, else
 * none. A name that matches nothing, or more than one, is refused rather than guessed.
 */
export function pickSite(sites: { id: string; name: string }[], clientName: string, named?: string): string | null {
  const want = named?.trim();
  if (!want) return sites.length === 1 ? sites[0].id : null;
  if (UUID_RE.test(want)) {
    const byId = sites.find((s) => s.id.toLowerCase() === want.toLowerCase());
    if (byId) return byId.id;
  }
  const low = want.toLowerCase();
  const exact = sites.filter((s) => s.name.trim().toLowerCase() === low);
  if (exact.length === 1) return exact[0].id;
  const part = exact.length > 1 ? exact : sites.filter((s) => s.name.toLowerCase().includes(low));
  if (part.length === 1) return part[0].id;
  if (part.length > 1) throw new ApiError(`More than one site of ${cleanLine(clientName, 60)} matches ${quoted(want)}. Which one?`, 409, 'site_ambiguous');
  throw new ApiError(`${cleanLine(clientName, 60)} has no site called ${quoted(want)}.`, 404, 'site_missing');
}

/** The reach check of the task a start op will create (assigned to the owner, so it reaches nothing). */
export function reachOfNewTask(
  ctx: OpContext,
  task: { title: string; description: string | null; requirements: unknown; client_id: string | null; site_id: string | null; tags: string[] },
  origin: ReachOrigin,
): ReachResult {
  return checkTaskCreate({
    task: { id: PLACEHOLDER_TASK_ID, assignee_id: ctx.ownerId, status: 'not_started', project_id: null, arc_id: null, sop_id: null, ...task },
    assignee_resolved: true,
    now: ctx.now,
    origin,
  });
}

export async function createStartTask(
  db: OpDb,
  a: { id: string; title: string; description: string | null; requirements: unknown; client_id: string | null; site_id: string | null; accord_id: string | null; tags: string[]; ownerId: string },
): Promise<void> {
  await db.task.create({
    data: {
      id: a.id,
      title: a.title,
      description: a.description,
      requirements: a.requirements as never,
      status: 'not_started',
      assignee_id: a.ownerId,
      client_id: a.client_id,
      site_id: a.site_id,
      accord_id: a.accord_id,
      project_id: null,
      tags: a.tags,
      created_by_id: START_CREATED_BY,
    },
    select: { id: true },
  });
}

/**
 * The shared Undo condition: the kickoff or pricing task is still the owner's, not started, and nothing waits on it.
 * Returns the reach of putting it to `abandoned` (the existing Undo check). Anything else is "Changed since".
 */
export async function checkStartTaskUndo(ctx: OpContext, taskId: string, changed: string): Promise<ReachResult> {
  const loaded = await loadReachTask(ctx.db, taskId);
  if (!loaded || loaded.row.assignee_id !== ctx.ownerId || loaded.row.status !== 'not_started' || (loaded.reach.dependents?.length ?? 0) > 0) {
    throw new ApiError(changed, 409, 'changed_since');
  }
  return checkUndo({ current: loaded.reach, restore: { status: 'abandoned' }, now: ctx.now });
}

/** Task to `abandoned` by compare-and-set; false when it moved on. */
export async function abandonStartTask(db: OpDb, taskId: string, ownerId: string): Promise<boolean> {
  const r = await db.task.updateMany({ where: { id: taskId, assignee_id: ownerId, status: 'not_started', is_deleted: false }, data: { status: 'abandoned' } });
  if (r.count === 1) await closeAsksForTask(db as unknown as Parameters<typeof closeAsksForTask>[0], taskId, 'abandoned'); // Work stage A
  return r.count === 1;
}

/** Run `fn` in one transaction when the client can open one (a client already in a transaction just runs it). */
export async function inOneTransaction<T>(db: OpDb, fn: (tx: OpDb) => Promise<T>): Promise<T> {
  const d = db as unknown as { $transaction?: (f: (tx: OpDb) => Promise<T>) => Promise<T> };
  return typeof d.$transaction === 'function' ? d.$transaction((tx) => fn(tx)) : fn(db);
}
