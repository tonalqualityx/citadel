/**
 * Designer Portal: start new work on a site that has no task yet (Mike, 2026-10-29: "no way to start working on
 * a site that needs something"). The task is created by the server from a fixed shape, then the normal session
 * engine (createOrGetSession) runs, so every drawer rule still applies to it.
 *
 * Open project for a site: the most recent non-deleted project in `ready | in_progress | review` whose `site_id`
 * is the site or that has a live task naming the site. A designer is limited to projects she is on.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { DESIGN_SITE_TYPE, DESIGN_VISIBLE_PROJECT_STATUSES, assignedProjectIdsFor } from './access';
import { createOrGetSession, loadSessionDefaults } from './sessions';
import { isUuid, type DesignActor } from './helpers';

export const WORK_TAG = 'design-work';
export const MAX_WORK_TITLE = 120;
export const MAX_WORK_DETAIL = 2000;
/** Energy 3 (about an hour), mystery average, average drain: a sensible default the PM can change. */
export const WORK_ENERGY = 3;

type Db = PrismaClient;

function openProjectWhere(assigned: readonly string[] | null): Prisma.ProjectWhereInput {
  return {
    is_deleted: false,
    status: { in: [...DESIGN_VISIBLE_PROJECT_STATUSES] },
    ...(assigned ? { id: { in: [...assigned] } } : {}),
  };
}

/** Sites the caller may start work on: design-enabled, eleventy, with an open project (a designer: one she is on). admin only; pm gets none (it cannot open sessions). */
export async function loadStartSites(actor: Pick<DesignActor, 'userId' | 'role'>, db: Pick<Db, 'site' | 'projectTeamAssignment'> = defaultDb): Promise<Array<{ id: string; name: string }>> {
  if (actor.role !== 'designer' && actor.role !== 'admin') return [];
  const assigned = actor.role === 'designer' ? await assignedProjectIdsFor(actor.userId, db) : null;
  if (assigned && assigned.length === 0) return [];
  const project = openProjectWhere(assigned);
  return db.site.findMany({
    where: {
      is_deleted: false,
      design_portal_enabled: true,
      site_type: DESIGN_SITE_TYPE,
      OR: [{ projects: { some: project } }, { tasks: { some: { is_deleted: false, project } } }],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export interface StartWorkInput {
  site_id: string;
  title: string;
  detail?: string;
}

export async function startWork(actor: DesignActor, input: StartWorkInput, db: Db = defaultDb): Promise<{ session_id: string; task_id: string }> {
  if (actor.role !== 'designer' && actor.role !== 'admin') throw new ApiError('Forbidden', 403, 'forbidden');
  if (!isUuid(input.site_id)) throw new ApiError('Site not found', 404, 'not_found');
  const title = input.title.trim();
  if (!title) throw new ApiError('Title is required', 400, 'bad_title');
  const detail = (input.detail ?? '').trim();

  const site = await db.site.findUnique({
    where: { id: input.site_id },
    select: { id: true, is_deleted: true, design_portal_enabled: true, site_type: true },
  });
  if (!site || site.is_deleted) throw new ApiError('Site not found', 404, 'not_found');

  // A designer must be on a project for this site (any status): else the site does not exist for her.
  const assigned = actor.role === 'designer' ? await assignedProjectIdsFor(actor.userId, db) : null;
  const siteProject: Prisma.ProjectWhereInput = {
    is_deleted: false,
    OR: [{ site_id: site.id }, { tasks: { some: { site_id: site.id, is_deleted: false } } }],
  };
  if (assigned) {
    const mine = assigned.length > 0 ? await db.project.findFirst({ where: { ...siteProject, id: { in: assigned } }, select: { id: true } }) : null;
    if (!mine) throw new ApiError('Site not found', 404, 'not_found');
  }
  if (!site.design_portal_enabled) throw new ApiError('This site is not set up for the Designer Portal', 409, 'site_not_enabled');
  if (site.site_type !== DESIGN_SITE_TYPE) throw new ApiError('Only eleventy sites can use the Designer Portal', 409, 'site_not_eleventy');

  const project = await db.project.findFirst({
    where: { ...siteProject, ...openProjectWhere(assigned) },
    orderBy: { created_at: 'desc' },
    select: { id: true, client_id: true },
  });
  if (!project) throw new ApiError('no open project for this site', 409, 'no_open_project');

  // Check what the session engine would refuse before a task exists, so a refusal leaves no orphan.
  const [defaults, state] = await Promise.all([
    loadSessionDefaults(db),
    db.designWorkerState.findUnique({ where: { id: 1 }, select: { configured_site_ids: true } }),
  ]);
  if (!defaults.enabled) throw new ApiError('The designer portal is switched off', 409, 'portal_disabled');
  if (!(state?.configured_site_ids ?? []).includes(site.id)) throw new ApiError('This site is not available yet', 409, 'site_not_available');

  const task = await db.task.create({
    data: {
      title,
      description: detail || null,
      status: 'not_started',
      project_id: project.id,
      client_id: project.client_id,
      site_id: site.id,
      assignee_id: actor.userId,
      created_by_id: actor.userId,
      tags: [WORK_TAG],
      source: 'internal',
      energy_estimate: WORK_ENERGY,
      mystery_factor: 'average',
      battery_impact: 'average_drain',
      estimated_minutes: calculateEstimatedMinutes(WORK_ENERGY, 'average', 'average_drain'),
    },
    select: { id: true },
  });
  try {
    const { session } = await createOrGetSession(actor, task.id, db);
    return { session_id: session.id, task_id: task.id };
  } catch (error) {
    // The session engine refused after the task was made (a race with the kill switch, say): do not leave it behind.
    await db.task.update({ where: { id: task.id }, data: { is_deleted: true } }).catch(() => undefined);
    throw error;
  }
}
