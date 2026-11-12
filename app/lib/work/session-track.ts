/**
 * Work stage E: "Track this?", the one question a session asks when there is real work and no link. On the owner's yes the session
 * calls this, and Citadel makes the work: a task, or a project when the session named several deliverables, assigned to the owner,
 * with the session attached to it.
 *
 * It goes through the guard (checkTracked): when work already carries the session, nothing is created and the answer is
 * already_tracked with the work's link. Adding tasks to a project the session names (a live one) is fine. A finished project is never
 * reused. One Handled line with Undo (72 hours): the tasks it made go to abandoned (only while still untouched), the project to
 * cancelled (only when nothing in it is live), the session link is detached.
 *
 * TODO(stage-f): "Track it" will also capture the estimated time spent; Stage F adds that field to the body. Nothing here guesses a
 * time.
 */

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { displayText } from '@/lib/home/copy';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import { closeAsksForTask, homeOwner } from './ask-closure';
import { resolveSource } from './candidates-store';
import { checkTracked, type Handled } from './guard';
import { attachSource, loadTarget, undoAttach, type AttachRecord } from './links';
import { clip, parseTargetKey, targetKeyOf } from './keys';
import { workHref } from './state';
import { TRACK_MESSAGES, trackedFromSessionLine } from './session-copy';

export const SESSION_TRACK_ACTION = 'session_track';
export const TRACK_UNDO_HOURS = 72;
const HOUR_MS = 3_600_000;
export const DELIVERABLES_MAX = 12;

export interface TrackRequest {
  ref: string;
  title: string;
  project_target: string | null;
  deliverables: string[];
  /** The owner's own "track it anyway" (a browser session or the chat only; the route decides). */
  create_anyway?: boolean;
  attached_by: 'auto' | 'mike' | 'bast' | 'intake';
  now?: Date;
}

export type TrackOutcome =
  | { result: 'skipped'; skipped: 'home_off' }
  | { result: 'already_tracked'; handled: Handled }
  | { result: 'tracked'; target_key: string; name: string; href: string; project_id: string | null; task_ids: string[]; action_id: string }

export interface SessionTrackRecord {
  kind: 'session_track';
  attach: AttachRecord | null;
  created_project_id: string | null;
  created_task_ids: string[];
}

export function readTrackRecord(v: unknown): SessionTrackRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = (v as { session_track?: unknown }).session_track as Partial<SessionTrackRecord> | undefined;
  return r && r.kind === 'session_track' && Array.isArray(r.created_task_ids) ? (r as SessionTrackRecord) : null;
}

export async function trackFromSession(db: PrismaClient, req: TrackRequest): Promise<TrackOutcome> {
  const now = req.now ?? new Date();
  const owner = await homeOwner(db as unknown as HomeDb);
  if (!owner) return { result: 'skipped', skipped: 'home_off' };
  const title = clip(displayText(req.title), 400).trim();
  if (!title) throw new ApiError('Track it needs a title.', 400, 'bad_request');
  const deliverables = req.deliverables.map((d) => clip(displayText(d), 400).trim()).filter(Boolean).slice(0, DELIVERABLES_MAX);

  // A named project is "add tasks to this live project"; no project is new work, and new work is what the guard protects.
  let project: { id: string; name: string; client_id: string | null; site_id: string | null } | null = null;
  if (req.project_target) {
    const p = parseTargetKey(req.project_target);
    if (!p || p.type !== 'project') throw new ApiError(TRACK_MESSAGES.notProject, 400, 'bad_request');
    const t = await loadTarget(db as unknown as HomeDb, req.project_target);
    if (!t) throw new ApiError('That project does not exist.', 404, 'target_missing');
    if (t.finished || !['ready', 'in_progress', 'review'].includes(t.status)) throw new ApiError(TRACK_MESSAGES.notLive, 409, 'target_finished');
    const row = await db.project.findUnique({ where: { id: t.id }, select: { id: true, name: true, client_id: true, site_id: true } });
    project = row ? { id: row.id, name: row.name, client_id: row.client_id, site_id: row.site_id } : null;
  } else {
    const handled = await checkTracked(db as unknown as HomeDb, [{ kind: 'session', ref: req.ref }], { override: req.create_anyway === true });
    if (handled) return { result: 'already_tracked', handled };
  }

  const src = await resolveSource(db as unknown as HomeDb, { kind: 'session', ref: req.ref });
  const clientId = project?.client_id ?? src.client?.id ?? null;
  const siteId = project?.site_id ?? src.site_id ?? null;
  const several = !project && deliverables.length >= 2;
  if (several && !clientId) throw new ApiError(TRACK_MESSAGES.noClient, 409, 'no_client');

  return db.$transaction(async (tx) => {
    const txh = tx as unknown as HomeDb;
    const rec: SessionTrackRecord = { kind: 'session_track', attach: null, created_project_id: null, created_task_ids: [] };
    const taskTitles = project ? (deliverables.length > 0 ? deliverables : [title]) : several ? deliverables : [title];
    let projectId: string | null = project?.id ?? null;
    let name = project ? project.name : title;
    if (several) {
      const made = await tx.project.create({
        data: { name: title, description: 'Started from a session the owner said to track.', status: 'in_progress', type: 'project', client_id: clientId as string, site_id: siteId, created_by_id: owner.id, next_step_owner_id: owner.id, next_step_source: 'bast', next_step_at: now },
        select: { id: true },
      });
      projectId = made.id;
      rec.created_project_id = made.id;
    }
    for (const taskTitle of taskTitles) {
      // The guard was asked above (checkTracked) for new work; a named live project takes its tasks without a question.
      const task = await tx.task.create({
        data: { title: taskTitle, status: 'not_started', assignee_id: owner.id, client_id: clientId, site_id: siteId, project_id: projectId, created_by_id: owner.id, tags: [], source: 'session' as never, source_session_external_id: req.ref },
        select: { id: true },
      });
      rec.created_task_ids.push(task.id);
    }
    // The session attaches to the project when there is one, else to the one task.
    const targetKey = projectId ? targetKeyOf('project', projectId) : targetKeyOf('task', rec.created_task_ids[0]);
    const res = await attachSource(txh, { kind: 'session', ref: req.ref, label: title, target_key: targetKey, attached_by: req.attached_by, basis: 'tracked', now });
    rec.attach = res.record;
    const line = trackedFromSessionLine(name, rec.created_task_ids.length);
    const row = await appendHomeAction(txh, owner.id, {
      item_key: null,
      action: SESSION_TRACK_ACTION,
      source: 'keeper',
      before: { states: [], session_track: rec },
      after: { states: [], session_track: rec, line, details: [`${displayText(name)}. ${workHref(projectId ? 'project' : 'task', projectId ?? rec.created_task_ids[0])}`], href: null },
      undo_until: new Date(now.getTime() + TRACK_UNDO_HOURS * HOUR_MS),
    });
    name = displayText(name);
    return { result: 'tracked' as const, target_key: targetKey, name, href: workHref(projectId ? 'project' : 'task', projectId ?? rec.created_task_ids[0]), project_id: projectId, task_ids: rec.created_task_ids, action_id: row.id };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Undo (called from runHomeUndo inside its transaction). Compare-and-set; anything the owner touched since stays. */
export async function undoSessionTrack(db: HomeDb, userId: string, rec: SessionTrackRecord, now: Date): Promise<void> {
  if (rec.attach) await undoAttach(db, rec.attach, now);
  for (const id of rec.created_task_ids) {
    const r = await db.task.updateMany({ where: { id, assignee_id: userId, status: 'not_started', is_deleted: false }, data: { status: 'abandoned' } });
    if (r.count === 1) await closeAsksForTask(db as unknown as Parameters<typeof closeAsksForTask>[0], id, 'abandoned');
  }
  if (rec.created_project_id) {
    await db.project.updateMany({ where: { id: rec.created_project_id, status: 'in_progress', is_deleted: false, tasks: { none: { status: { notIn: ['abandoned'] } } } }, data: { status: 'cancelled' } });
  }
}

