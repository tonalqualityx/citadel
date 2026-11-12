/**
 * Work stage D: attaching a source to a piece of work, and the ONE question when the match is unclear.
 *
 * attachOrPropose is the door the intake, the session close pass and the chat use:
 *   - a target named by the caller: attach it (and write one Handled line with Undo, unless the owner chose it himself);
 *   - propose: work out the candidates (candidates-store.ts). A clear match (exactly one candidate, basis same_conversation,
 *     plan_folder or prior_choice) attaches quietly with a Handled line and Undo. Anything else is ONE question row with a link on
 *     each candidate and the buttons: one per candidate, New project, Just a task, Not work. When in doubt, ask.
 * attachChoose is the owner's answer. Every answer has Undo (72 hours, compare-and-set, nothing deleted): the attach is detached
 * again with the asks' stamps put back, a project the answer started goes to cancelled, a task it made goes to abandoned, and the
 * question comes back.
 *
 * Nothing here sends, drafts, closes or deletes anything. Owner only: with no home owner on the home view it writes nothing.
 */

import { ApiError } from '@/lib/api/errors';
import { displayText } from '@/lib/home/copy';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import { closeAsksForTask, homeOwner } from './ask-closure';
import { ATTACH_TOAST, attachQuestion, attachedLine } from './attach-copy';
import { resolveSource } from './candidates-store';
import { attachSource, inOneTransaction, loadTarget, readAttachRecord, undoAttach, type AttachRecord, type AttachedBy } from './links';
import { checkTracked } from './guard';
import { PROPOSED_TARGET, clip, parseTargetKey, targetKeyOf, type WorkKind } from './keys';
import { workHref } from './state';
import type { Candidate } from './candidates';

export const WORK_ATTACH_ACTION = 'work_attach';
export const ATTACH_CHOOSE_ACTION = 'attach_choose';
export const ATTACH_UNDO_HOURS = 72;
const HOUR_MS = 3_600_000;
const ATTACH_KEY_PREFIX = 'attach:';

export const attachItemKey = (linkId: string): string => `${ATTACH_KEY_PREFIX}${linkId}`;
export function parseAttachKey(key: string): string | null {
  const m = key.match(/^attach:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
  return m ? m[1] : null;
}

export interface QuestionContext {
  client_id: string | null;
  client_name: string | null;
  site_id: string | null;
  title: string;
  who: string | null;
  can_task: boolean;
}

export interface StoredCandidate {
  target_key: string;
  label: string;
  href: string;
  basis?: string;
}

export interface AttachRequest {
  kind: WorkKind;
  ref: string;
  label?: string | null;
  target_key?: string | null;
  propose?: boolean;
  /** Propose only: restrict to these target keys (each must be live). */
  candidates?: string[] | null;
  client_id?: string | null;
  cwd?: string | null;
  repo_remote?: string | null;
  /** Propose only: the source names one deliverable, so "Just a task" is offered. Default false: a multi-step item is a project. */
  one_deliverable?: boolean;
  /** Work stage E: judge a session by its folder alone, so a second project it works in gets its own link or question. */
  ignore_existing?: boolean;
  attached_by: AttachedBy;
  now?: Date;
}

export type AttachOutcome =
  | { result: 'attached'; link_id: string; target_key: string; name: string; action_id: string | null }
  | { result: 'already'; link_id: string; target_key: string; name: string }
  | { result: 'proposed'; link_id: string; candidates: StoredCandidate[] }
  | { result: 'dismissed' }
  | { result: 'none' }
  | { result: 'skipped'; skipped: 'home_off' };

/** The Handled line of a quiet attach (source keeper, Undo for 72 hours). */
async function writeAttachLine(db: HomeDb, ownerId: string, rec: AttachRecord, kind: WorkKind, who: string | null, name: string, href: string | null, now: Date): Promise<string> {
  const line = attachedLine(kind, who, name);
  const row = await appendHomeAction(db, ownerId, {
    item_key: null,
    action: WORK_ATTACH_ACTION,
    source: 'keeper',
    before: { states: [], work_attach: rec },
    after: { states: [], work_attach: rec, line, details: [`${displayText(name)}. ${workHref(parseTargetKey(rec.target_key)?.type ?? 'task', parseTargetKey(rec.target_key)?.id ?? '')}`], href },
    undo_until: new Date(now.getTime() + ATTACH_UNDO_HOURS * HOUR_MS),
  });
  return row.id;
}

const toStored = (c: Candidate): StoredCandidate => {
  const p = parseTargetKey(c.target_key);
  return { target_key: c.target_key, label: c.label, href: p ? workHref(p.type, p.id) : '', basis: c.basis };
};

export async function attachOrPropose(db: HomeDb, req: AttachRequest): Promise<AttachOutcome> {
  const now = req.now ?? new Date();
  const owner = await homeOwner(db);
  if (!owner) return { result: 'skipped', skipped: 'home_off' };

  // A target the caller named.
  if (req.target_key) {
    const target = await loadTarget(db, req.target_key);
    if (!target) throw new ApiError('That project or task does not exist.', 404, 'target_missing');
    const res = await attachSource(db, { kind: req.kind, ref: req.ref, label: req.label, target_key: req.target_key, attached_by: req.attached_by, basis: 'named', now });
    if (res.result === 'already' || !res.record) return { result: 'already', link_id: res.link_id, target_key: res.target_key, name: target.name };
    const src = await resolveSource(db, { kind: req.kind, ref: req.ref });
    const actionId = req.attached_by === 'mike' ? null : await writeAttachLine(db, owner.id, res.record, req.kind, src.who ?? req.label ?? null, target.name, src.href, now);
    return { result: 'attached', link_id: res.link_id, target_key: res.target_key, name: target.name, action_id: actionId };
  }
  if (!req.propose) throw new ApiError('Name a target_key, or ask to propose.', 400, 'bad_request');

  // A question that was answered "Not work" is never asked again for the same source.
  const prior = await db.workLink.findUnique({ where: { kind_ref_target_key: { kind: req.kind, ref: req.ref, target_key: PROPOSED_TARGET } }, select: { id: true, state: true, basis: true } });
  if (prior && prior.state === 'detached' && prior.basis === 'not_work') return { result: 'dismissed' };

  const src = await resolveSource(db, { kind: req.kind, ref: req.ref, client_id: req.client_id, cwd: req.cwd, repo_remote: req.repo_remote, ignore_existing: req.ignore_existing });
  let resolution = src.resolution;

  // The caller may name the candidates; each must be live, and a named list is always a question (no basis says it is clear).
  if (req.candidates && req.candidates.length > 0 && resolution.action !== 'already') {
    const live: Candidate[] = [];
    for (const k of req.candidates.slice(0, 8)) {
      const t = await loadTarget(db, k);
      if (t && !t.finished && !(t.type === 'project' && !['ready', 'in_progress', 'review'].includes(t.status))) live.push({ target_key: targetKeyOf(t.type, t.id), label: t.name, basis: 'client_project' });
    }
    resolution = live.length > 0 ? { action: 'ask', candidates: live, can_new_project: !!src.client } : resolution;
  }

  if (resolution.action === 'none') return { result: 'none' };
  if (resolution.action === 'already') {
    const res = await attachSource(db, { kind: req.kind, ref: req.ref, label: req.label, target_key: resolution.target.target_key, attached_by: req.attached_by, basis: 'same_conversation', now });
    return { result: 'already', link_id: res.link_id, target_key: res.target_key, name: resolution.target.label };
  }
  if (resolution.action === 'quiet') {
    const res = await attachSource(db, { kind: req.kind, ref: req.ref, label: req.label, target_key: resolution.target.target_key, attached_by: req.attached_by, basis: resolution.target.basis, now });
    if (res.result === 'already' || !res.record) return { result: 'already', link_id: res.link_id, target_key: res.target_key, name: resolution.target.label };
    const actionId = await writeAttachLine(db, owner.id, res.record, req.kind, src.who ?? req.label ?? null, resolution.target.label, src.href, now);
    return { result: 'attached', link_id: res.link_id, target_key: res.target_key, name: resolution.target.label, action_id: actionId };
  }

  // One question row, one per source.
  const candidates = resolution.candidates.map(toStored);
  const ctx: QuestionContext = {
    client_id: src.client?.id ?? null,
    client_name: src.client?.name ?? null,
    site_id: src.site_id,
    title: clip(displayText(src.title ?? req.label ?? 'Work from a message'), 120) || 'Work from a message',
    who: src.who,
    can_task: req.one_deliverable === true,
  };
  const data = { project_id: null, task_id: null, label: clip(req.label ?? (src.who && src.title ? `${src.who}: ${src.title}` : src.title ?? src.who ?? ''), 300) || null, attached_by: req.attached_by, basis: null, state: 'proposed', candidates: candidates as never, context: { ...ctx, can_new_project: resolution.can_new_project } as never, last_seen_at: now, detached_at: null };
  const row = await db.workLink.upsert({
    where: { kind_ref_target_key: { kind: req.kind, ref: req.ref, target_key: PROPOSED_TARGET } },
    create: { ...data, kind: req.kind, ref: req.ref, target_key: PROPOSED_TARGET, first_seen_at: now },
    update: data,
    select: { id: true },
  });
  return { result: 'proposed', link_id: row.id, candidates };
}

// ----------------------------------------------------------------------------
// The question row on the home screen
// ----------------------------------------------------------------------------

export interface RawAttachQuestion {
  link_id: string;
  kind: WorkKind;
  ref: string;
  title: string;
  who: string | null;
  client_name: string | null;
  source_href: string | null;
  candidates: { target_key: string; label: string; href: string }[];
  can_new_project: boolean;
  can_task: boolean;
  since: Date;
}

const readCtx = (v: unknown): (QuestionContext & { can_new_project?: boolean }) | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as QuestionContext) : null);

/** The owner's open questions, re-read live: a candidate that finished or went away since is dropped. */
export async function loadAttachQuestions(db: HomeDb, userId: string): Promise<RawAttachQuestion[]> {
  const owner = await homeOwner(db);
  if (!owner || owner.id !== userId) return [];
  const rows = await db.workLink.findMany({ where: { target_key: PROPOSED_TARGET, state: 'proposed' }, orderBy: { created_at: 'asc' }, take: 20 });
  const out: RawAttachQuestion[] = [];
  for (const r of rows) {
    const kind = r.kind as WorkKind;
    // The source must still be there to ask about.
    let sourceHref: string | null = null;
    if (kind === 'email') {
      const ask = await db.emailAsk.findFirst({ where: { state: 'open', OR: [{ conversation_key: r.ref }, { rfc_message_id: r.ref }, { message_id: r.ref }] }, select: { deep_link: true }, orderBy: { received_at: 'desc' } });
      if (!ask) continue;
      sourceHref = ask.deep_link;
    } else if (kind === 'session') {
      const s = await db.oracleSession.findFirst({ where: { external_id: r.ref, archived_at: null }, select: { remote_url: true } });
      if (!s) continue;
      sourceHref = s.remote_url;
    }
    const ctx = readCtx(r.context);
    const stored = Array.isArray(r.candidates) ? (r.candidates as unknown as StoredCandidate[]) : [];
    const live: RawAttachQuestion['candidates'] = [];
    for (const c of stored) {
      const t = await loadTarget(db, c.target_key);
      if (!t || t.finished) continue;
      if (t.type === 'project' && !['ready', 'in_progress', 'review'].includes(t.status)) continue;
      live.push({ target_key: c.target_key, label: t.name, href: workHref(t.type, t.id) });
    }
    const canNew = !!ctx?.client_id && (ctx as { can_new_project?: boolean }).can_new_project !== false;
    if (live.length === 0 && !canNew) continue;
    out.push({
      link_id: r.id,
      kind,
      ref: r.ref,
      title: attachQuestion({ kind, who: ctx?.who ?? null, client: ctx?.client_name ?? null, candidates: live.map((c) => c.label) }),
      who: ctx?.who ?? null,
      client_name: ctx?.client_name ?? null,
      source_href: sourceHref,
      candidates: live,
      can_new_project: canNew,
      can_task: ctx?.can_task === true,
      since: r.created_at,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// His answer
// ----------------------------------------------------------------------------

export interface AttachChooseRecord {
  kind: 'attach_choose';
  link_id: string;
  choice: string;
  attach: AttachRecord | null;
  created_project_id: string | null;
  created_task_id: string | null;
  dismissed: boolean;
  /** A session answered with a project: the folder it ran in is remembered as his choice (a `folder` link). Undo detaches it. */
  folder?: AttachRecord | null;
}

export function readAttachChooseRecord(v: unknown): AttachChooseRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = (v as { attach_choose?: unknown }).attach_choose;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const r = rec as Partial<AttachChooseRecord>;
  return r.kind === 'attach_choose' && typeof r.link_id === 'string' ? (r as AttachChooseRecord) : null;
}

export interface ChooseResponse {
  ok: true;
  action_id: string;
  undo_until: string;
  item_key: string;
  message: string;
}

const gone = () => new ApiError('That question is already answered.', 409, 'card_gone');
const changed = () => new ApiError('That changed since the question was asked. Open it and choose again.', 409, 'changed_since');

export async function attachChoose(db: HomeDb, userId: string, itemKey: string, choice: string, now: Date): Promise<ChooseResponse> {
  const linkId = parseAttachKey(itemKey);
  if (!linkId) throw new ApiError('That is not a question.', 404, 'not_found');
  const owner = await homeOwner(db);
  if (!owner || owner.id !== userId) throw new ApiError('That is not a question.', 404, 'not_found');

  return inOneTransaction(db, async (tx) => {
    const link = await tx.workLink.findFirst({ where: { id: linkId, target_key: PROPOSED_TARGET, state: 'proposed' } });
    if (!link) throw gone();
    const kind = link.kind as WorkKind;
    const ctx = readCtx(link.context);
    const stored = Array.isArray(link.candidates) ? (link.candidates as unknown as StoredCandidate[]) : [];
    const rec: AttachChooseRecord = { kind: 'attach_choose', link_id: link.id, choice, attach: null, created_project_id: null, created_task_id: null, dismissed: false };
    let message: string;

    if (choice === 'not_work') {
      await tx.workLink.update({ where: { id: link.id }, data: { state: 'detached', detached_at: now, basis: 'not_work' } });
      rec.dismissed = true;
      message = ATTACH_TOAST.notWork;
    } else if (choice === 'new_project') {
      if (!ctx?.client_id) throw changed();
      const client = await tx.client.findFirst({ where: { id: ctx.client_id, is_deleted: false }, select: { id: true } });
      if (!client) throw changed();
      const name = clip(displayText(ctx.title), 120) || 'Work from a message';
      const project = await tx.project.create({
        data: {
          name,
          description: 'Started from a question on the home screen.',
          status: 'in_progress',
          type: 'project',
          client_id: client.id,
          site_id: ctx.site_id ?? null,
          created_by_id: userId,
          next_step_owner_id: userId,
          next_step_source: 'bast',
          next_step_at: now,
        },
        select: { id: true },
      });
      rec.created_project_id = project.id;
      const res = await attachSource(tx, { kind, ref: link.ref, label: link.label, target_key: targetKeyOf('project', project.id), attached_by: 'mike', basis: 'new_project', now, move: true });
      rec.attach = res.record;
      message = ATTACH_TOAST.newProject(name);
    } else if (choice === 'task') {
      if (!ctx?.can_task) throw changed();
      // The owner's own "Just a task": the explicit override of the guard, named here so the invariant test can see it.
      await checkTracked(tx, [{ kind, ref: link.ref }], { override: true });
      const title = clip(displayText(ctx.title), 400) || 'Work from a message';
      const task = await tx.task.create({
        data: {
          title,
          status: 'not_started',
          assignee_id: userId,
          client_id: ctx.client_id ?? null,
          site_id: ctx.site_id ?? null,
          created_by_id: userId,
          tags: [],
          ...(kind === 'session' ? { source: 'session' as never, source_session_external_id: link.ref } : {}),
        },
        select: { id: true },
      });
      rec.created_task_id = task.id;
      const res = await attachSource(tx, { kind, ref: link.ref, label: link.label, target_key: targetKeyOf('task', task.id), attached_by: 'mike', basis: 'new_task', now, move: true });
      rec.attach = res.record;
      message = ATTACH_TOAST.task(title);
    } else {
      const offered = stored.find((c) => c.target_key === choice);
      const target = offered ? await loadTarget(tx, choice) : null;
      if (!offered || !target || target.finished || (target.type === 'project' && !['ready', 'in_progress', 'review'].includes(target.status))) throw changed();
      const res = await attachSource(tx, { kind, ref: link.ref, label: link.label, target_key: choice, attached_by: 'mike', basis: 'chosen', now, move: true });
      rec.attach = res.record;
      if (kind === 'session' && target.type === 'project') rec.folder = await rememberFolder(tx, link.ref, choice, now);
      message = ATTACH_TOAST.attached(target.name);
    }

    const undoUntil = new Date(now.getTime() + ATTACH_UNDO_HOURS * HOUR_MS);
    const row = await appendHomeAction(tx, userId, {
      item_key: itemKey,
      action: ATTACH_CHOOSE_ACTION,
      before: { states: [], attach_choose: rec },
      after: { states: [], attach_choose: rec },
      undo_until: undoUntil,
    });
    return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: itemKey, message };
  });
}

/** A session answered with a project: its working folder maps to that project from now on (a `folder` link, the "prior_choice" basis). */
async function rememberFolder(tx: HomeDb, sessionRef: string, projectKey: string, now: Date): Promise<AttachRecord | null> {
  const sess = await tx.oracleSession.findFirst({ where: { external_id: sessionRef }, select: { cwd: true }, orderBy: { last_event_at: 'desc' } });
  const cwd = (sess?.cwd ?? '').trim().replace(/\/+$/, '');
  if (!cwd || cwd.length > 300) return null;
  const res = await attachSource(tx, { kind: 'folder', ref: cwd, label: cwd, target_key: projectKey, attached_by: 'mike', basis: 'chosen', now, move: true });
  return res.record;
}

/** Undo of an answer (called from runHomeUndo inside its transaction). Compare-and-set; anything he changed since stays. */
export async function undoAttachChoose(db: HomeDb, userId: string, rec: AttachChooseRecord, now: Date): Promise<void> {
  if (rec.dismissed) {
    await db.workLink.updateMany({ where: { id: rec.link_id, state: 'detached', basis: 'not_work' }, data: { state: 'proposed', detached_at: null, basis: null } });
    return;
  }
  // The attach first: it unstamps the asks, so ending the task below closes none of them.
  if (rec.attach) await undoAttach(db, rec.attach, now);
  if (rec.folder) await undoAttach(db, rec.folder, now);
  if (rec.created_task_id) {
    const r = await db.task.updateMany({ where: { id: rec.created_task_id, assignee_id: userId, status: 'not_started', is_deleted: false }, data: { status: 'abandoned' } });
    if (r.count === 1) await closeAsksForTask(db, rec.created_task_id, 'abandoned');
  }
  if (rec.created_project_id) {
    await db.project.updateMany({ where: { id: rec.created_project_id, status: 'in_progress', is_deleted: false, tasks: { none: {} } }, data: { status: 'cancelled' } });
  }
}

export { readAttachRecord, undoAttach };
