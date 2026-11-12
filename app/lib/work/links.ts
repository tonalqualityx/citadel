/**
 * Work stage D: attachSource, the ONE writer of work_link rows that make a source part of a piece of work.
 *
 * - A source (kind, ref) attaches to one target, a project or a task. A session may attach to several targets; every other kind
 *   attaches once. Moving an attached source needs `move: true` (the owner's own choice); without it a second target is refused.
 * - An email conversation has at most one active target. That is enforced here, in one transaction, under an advisory lock on the
 *   source and a row lock (FOR UPDATE) on the conversation's asks.
 * - Writing an email link stamps task_id and project_id on that conversation's asks, so Stage A's field and the link never disagree.
 *   The previous values are recorded, and Undo puts back exactly those (compare-and-set: an ask changed since stays as it is).
 * - It never closes, deletes or changes the status of anything. An ask is not closed by being attached; Stage A closes an ask only
 *   when its task ends.
 * - A finished target (a done or cancelled project, a done or abandoned task) is refused: finished work is never reused.
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import type { HomeDb } from '@/lib/home/state';
import { MULTI_TARGET_KINDS, PROPOSED_TARGET, clip, parseTargetKey, targetKeyOf, type TargetType, type WorkKind } from './keys';

export const LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
export const FINISHED_TASK_STATUSES = ['done', 'abandoned'] as const;
export const FINISHED_PROJECT_STATUSES = ['done', 'cancelled'] as const;

export type AttachedBy = 'auto' | 'mike' | 'bast' | 'intake';

export interface AttachInput {
  kind: WorkKind;
  ref: string;
  label?: string | null;
  target_key: string;
  attached_by: AttachedBy;
  basis?: string | null;
  now?: Date;
  /** The owner's own choice may move a source from the target it is on. */
  move?: boolean;
  /** The home_actions row the Undo line belongs to, when there is one. */
  home_action_id?: string | null;
}

/** An ask's fields as they were before an email link stamped them. */
export interface StampRecord {
  ask_id: string;
  /** What the link wrote, so Undo can tell "still as the link left it". */
  wrote: { task_id: string | null; project_id: string | null; match_source: string | null };
  before: { task_id: string | null; project_id: string | null; match_source: string | null };
}

export interface AttachRecord {
  kind: 'work_attach';
  source: { kind: WorkKind; ref: string };
  link_id: string;
  target_key: string;
  /** A link this call created (true) or one it revived from detached or proposed (false, state restored on Undo). */
  created: boolean;
  revived_from: 'detached' | 'proposed' | null;
  /** The target the source was moved from (that link was detached; Undo makes it active again). */
  moved_link_id: string | null;
  /** The question row this attach answered (state proposed before; Undo puts it back). */
  answered_link_id: string | null;
  stamped: StampRecord[];
}

export interface AttachResult {
  /** 'attached' (a new or revived link), 'already' (it was attached there, last_seen moved forward). */
  result: 'attached' | 'already';
  link_id: string;
  target_key: string;
  record: AttachRecord | null;
}

export interface TargetFacts {
  type: TargetType;
  id: string;
  name: string;
  project_id: string | null;
  task_id: string | null;
  status: string;
  finished: boolean;
  client_id: string | null;
}

/** Run `fn` in one transaction when the client can open one; a client already in a transaction just runs it. */
export async function inOneTransaction<T>(db: HomeDb, fn: (tx: HomeDb) => Promise<T>): Promise<T> {
  const d = db as unknown as { $transaction?: (f: (tx: HomeDb) => Promise<T>, o?: { timeout: number; maxWait: number }) => Promise<T> };
  return typeof d.$transaction === 'function' ? d.$transaction((tx) => fn(tx), { timeout: 30_000, maxWait: 10_000 }) : fn(db);
}

/** The target a key names, with the facts every writer needs. null when it does not exist or is deleted. */
export async function loadTarget(db: HomeDb, targetKey: string): Promise<TargetFacts | null> {
  const p = parseTargetKey(targetKey);
  if (!p) return null;
  if (p.type === 'task') {
    const t = await db.task.findUnique({ where: { id: p.id }, select: { id: true, title: true, status: true, is_deleted: true, project_id: true, client_id: true } });
    if (!t || t.is_deleted) return null;
    return { type: 'task', id: t.id, name: t.title, project_id: t.project_id, task_id: t.id, status: t.status, finished: (FINISHED_TASK_STATUSES as readonly string[]).includes(t.status), client_id: t.client_id };
  }
  const pr = await db.project.findUnique({ where: { id: p.id }, select: { id: true, name: true, status: true, is_deleted: true, client_id: true } });
  if (!pr || pr.is_deleted) return null;
  return { type: 'project', id: pr.id, name: pr.name, project_id: pr.id, task_id: null, status: pr.status, finished: (FINISHED_PROJECT_STATUSES as readonly string[]).includes(pr.status), client_id: pr.client_id };
}

/** The asks of one email conversation, by the ref a link carries (conversation key, RFC id or message id). */
export const emailAskWhere = (ref: string): Prisma.EmailAskWhereInput => ({ OR: [{ conversation_key: ref }, { rfc_message_id: ref }, { message_id: ref }] });

async function lockSource(tx: HomeDb, kind: string, ref: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`work_link:${kind}:${ref}`}, 0))`;
  if (kind === 'email') {
    // Row lock on the conversation's asks, in id order (a stable order, so two writers cannot deadlock each other).
    await tx.$queryRaw`SELECT id FROM email_asks WHERE conversation_key = ${ref} OR rfc_message_id = ${ref} OR message_id = ${ref} ORDER BY id FOR UPDATE`;
  }
}

async function stampAsks(tx: HomeDb, ref: string, target: TargetFacts, movedFromTask: string | null, force: boolean): Promise<StampRecord[]> {
  const asks = await tx.emailAsk.findMany({ where: emailAskWhere(ref), select: { id: true, task_id: true, project_id: true, match_source: true }, orderBy: { id: 'asc' } });
  const out: StampRecord[] = [];
  for (const a of asks) {
    const before = { task_id: a.task_id, project_id: a.project_id, match_source: a.match_source as string | null };
    let task_id = a.task_id;
    let project_id = a.project_id;
    let match_source = before.match_source;
    if (target.type === 'task') {
      task_id = target.id;
      project_id = target.project_id ?? project_id;
    } else {
      // A project link: the ask belongs to the project, not to one of its tasks. When the source moved off a task, the task stamp goes.
      if (movedFromTask && task_id === movedFromTask) task_id = null;
      if (project_id === null || force) project_id = target.id;
    }
    if (force && match_source !== 'mike') match_source = 'mike';
    if (task_id === a.task_id && project_id === a.project_id && match_source === before.match_source) continue;
    await tx.emailAsk.update({ where: { id: a.id }, data: { task_id, project_id, ...(match_source !== before.match_source ? { match_source: match_source as never } : {}) } });
    out.push({ ask_id: a.id, wrote: { task_id, project_id, match_source }, before });
  }
  return out;
}

/** The active links of a source (a session may have several). */
export async function activeLinks(db: HomeDb, kind: WorkKind, ref: string) {
  return db.workLink.findMany({ where: { kind, ref, state: 'active' }, orderBy: { last_seen_at: 'desc' } });
}

export async function attachSource(db: HomeDb, input: AttachInput): Promise<AttachResult> {
  const now = input.now ?? new Date();
  const ref = clip(input.ref, 300);
  if (!ref) throw new ApiError('A source needs a ref.', 400, 'bad_ref');
  if (input.target_key === PROPOSED_TARGET) throw new ApiError('That is not a place to attach to.', 400, 'bad_target');

  return inOneTransaction(db, async (tx) => {
    const target = await loadTarget(tx, input.target_key);
    if (!target) throw new ApiError('That project or task does not exist.', 404, 'target_missing');
    if (target.finished) throw new ApiError('That work is finished. A finished project or task is never reused.', 409, 'target_finished');
    const tkey = targetKeyOf(target.type, target.id);

    await lockSource(tx, input.kind, ref);

    const actives = await activeLinks(tx, input.kind, ref);
    const same = actives.find((l) => l.target_key === tkey);
    if (same) {
      await tx.workLink.update({ where: { id: same.id }, data: { last_seen_at: now, ...(input.label ? { label: clip(input.label, 300) } : {}) } });
      return { result: 'already' as const, link_id: same.id, target_key: tkey, record: null };
    }

    const multi = (MULTI_TARGET_KINDS as readonly string[]).includes(input.kind);
    let movedLinkId: string | null = null;
    let movedFromTask: string | null = null;
    // Legacy: an email whose ask already points at another live task is on that task, link or no link.
    let legacyTask: string | null = null;
    if (!multi && input.kind === 'email' && actives.length === 0) {
      const other = await tx.emailAsk.findFirst({ where: { ...emailAskWhere(ref), task_id: { not: null } }, select: { task_id: true }, orderBy: { received_at: 'desc' } });
      if (other?.task_id && other.task_id !== target.id) {
        const t = await tx.task.findUnique({ where: { id: other.task_id }, select: { is_deleted: true, status: true } });
        if (t && !t.is_deleted && !(FINISHED_TASK_STATUSES as readonly string[]).includes(t.status)) legacyTask = other.task_id;
      }
    }
    if (!multi && (actives.length > 0 || legacyTask)) {
      if (!input.move) {
        const on = actives[0]?.target_key ?? `task:${legacyTask}`;
        throw new ApiError(`That source is already attached to ${on}. Moving it is the owner's choice.`, 409, 'already_attached');
      }
      for (const l of actives) {
        await tx.workLink.update({ where: { id: l.id }, data: { state: 'detached', detached_at: now } });
        movedLinkId = movedLinkId ?? l.id;
        if (l.task_id) movedFromTask = l.task_id;
      }
      if (legacyTask) movedFromTask = movedFromTask ?? legacyTask;
    }

    // The question row for this source, if there is one, is answered by this attach.
    const proposed = await tx.workLink.findFirst({ where: { kind: input.kind, ref, target_key: PROPOSED_TARGET, state: 'proposed' }, select: { id: true } });
    if (proposed) await tx.workLink.update({ where: { id: proposed.id }, data: { state: 'detached', detached_at: now, basis: 'answered' } });

    const existing = await tx.workLink.findUnique({ where: { kind_ref_target_key: { kind: input.kind, ref, target_key: tkey } }, select: { id: true, state: true } });
    let linkId: string;
    let revivedFrom: AttachRecord['revived_from'] = null;
    const data = {
      project_id: target.project_id,
      task_id: target.task_id,
      label: input.label ? clip(input.label, 300) : null,
      attached_by: input.attached_by,
      basis: input.basis ? clip(input.basis, 40) : null,
      state: 'active',
      candidates: Prisma.DbNull,
      context: Prisma.DbNull,
      last_seen_at: now,
      detached_at: null,
      home_action_id: input.home_action_id ?? null,
    };
    if (existing) {
      linkId = existing.id;
      revivedFrom = existing.state === 'proposed' ? 'proposed' : 'detached';
      await tx.workLink.update({ where: { id: existing.id }, data: { ...data, ...(input.label ? {} : { label: undefined }) } });
    } else {
      const made = await tx.workLink.create({ data: { ...data, target_key: tkey, kind: input.kind, ref, first_seen_at: now }, select: { id: true } });
      linkId = made.id;
    }

    const stamped = input.kind === 'email' ? await stampAsks(tx, ref, target, movedFromTask, input.attached_by === 'mike') : [];
    const record: AttachRecord = {
      kind: 'work_attach',
      source: { kind: input.kind, ref },
      link_id: linkId,
      target_key: tkey,
      created: !existing,
      revived_from: revivedFrom,
      moved_link_id: movedLinkId,
      answered_link_id: proposed?.id ?? null,
      stamped,
    };
    return { result: 'attached' as const, link_id: linkId, target_key: tkey, record };
  });
}

/**
 * Undo of an attach (compare-and-set, nothing deleted): the link goes back to detached (or proposed, when it was a revived question),
 * the link it moved from is active again, the question row it answered is proposed again, and each stamped ask gets back what it had,
 * unless it changed since.
 */
export async function undoAttach(db: HomeDb, rec: AttachRecord, now: Date): Promise<{ restored_asks: number }> {
  return inOneTransaction(db, async (tx) => {
    await lockSource(tx, rec.source.kind, rec.source.ref);
    await tx.workLink.updateMany({ where: { id: rec.link_id, state: 'active' }, data: { state: rec.revived_from === 'proposed' ? 'proposed' : 'detached', detached_at: rec.revived_from === 'proposed' ? null : now } });
    if (rec.moved_link_id) {
      // Only when nothing else took the source meanwhile (a single-target source has no other active link now).
      const other = await tx.workLink.count({ where: { kind: rec.source.kind, ref: rec.source.ref, state: 'active' } });
      if (other === 0) await tx.workLink.updateMany({ where: { id: rec.moved_link_id, state: 'detached' }, data: { state: 'active', detached_at: null } });
    }
    if (rec.answered_link_id) await tx.workLink.updateMany({ where: { id: rec.answered_link_id, state: 'detached', basis: 'answered' }, data: { state: 'proposed', detached_at: null, basis: null } });
    let restored = 0;
    for (const s of rec.stamped) {
      const r = await tx.emailAsk.updateMany({
        where: { id: s.ask_id, task_id: s.wrote.task_id, project_id: s.wrote.project_id },
        data: { task_id: s.before.task_id, project_id: s.before.project_id, ...(s.before.match_source !== s.wrote.match_source ? { match_source: s.before.match_source as never } : {}) },
      });
      restored += r.count;
    }
    return { restored_asks: restored };
  });
}

export function readAttachRecord(v: unknown): AttachRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = (v as { work_attach?: unknown }).work_attach;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const r = rec as Partial<AttachRecord>;
  if (r.kind !== 'work_attach' || typeof r.link_id !== 'string' || !r.source || !Array.isArray(r.stamped)) return null;
  return r as AttachRecord;
}
