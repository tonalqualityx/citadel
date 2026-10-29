/**
 * Designer Portal: the open tasks on the site a session is working on (the workspace "Tasks" tab).
 * Same visibility rules as the drawer (open task, live project in a visible status; a designer only on projects
 * she is assigned to) but scoped to ONE site: task.site_id = site, or no task site and the project's site = site.
 * The projection is an explicit allowlist: no billing, time, estimate, client or contact fields.
 */
import type { DesignSession, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { DESIGN_CLOSED_TASK_STATUSES, DESIGN_VISIBLE_PROJECT_STATUSES, assignedProjectIdsFor } from './access';
import type { DesignActor } from './helpers';

export const SITE_TASKS_LIMIT = 100;
export const SITE_TASK_DESCRIPTION_MAX = 1000;

export const SITE_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  due_date: true,
  description: true,
  assignee_id: true,
  assignee: { select: { name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

export interface SiteTaskView {
  id: string;
  title: string;
  status: string;
  due_date: Date | null;
  description: string | null;
  /** First name only. */
  assignee_first_name: string | null;
  mine: boolean;
  project: { id: string; name: string };
}

type Row = Prisma.TaskGetPayload<{ select: typeof SITE_TASK_SELECT }>;

export function projectSiteTask(t: Row, actorId: string): SiteTaskView {
  const first = t.assignee?.name?.trim().split(/\s+/)[0] ?? null;
  const desc = t.description?.trim() ? t.description.trim().slice(0, SITE_TASK_DESCRIPTION_MAX) : null;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    due_date: t.due_date,
    description: desc,
    assignee_first_name: first || null,
    mine: t.assignee_id === actorId,
    project: { id: t.project?.id ?? '', name: t.project?.name ?? '' },
  };
}

export async function loadSiteTasks(
  actor: Pick<DesignActor, 'userId' | 'role'>,
  session: Pick<DesignSession, 'site_id'>,
  opts: { mine: boolean },
  db: Pick<PrismaClient, 'task' | 'projectTeamAssignment'> = defaultDb,
): Promise<SiteTaskView[]> {
  let projectFilter: Prisma.TaskWhereInput['project_id'] = { not: null };
  if (actor.role === 'designer') {
    const assigned = await assignedProjectIdsFor(actor.userId, db);
    if (assigned.length === 0) return [];
    projectFilter = { in: assigned };
  }
  const rows = await db.task.findMany({
    where: {
      is_deleted: false,
      status: { notIn: [...DESIGN_CLOSED_TASK_STATUSES] },
      project_id: projectFilter,
      project: { is_deleted: false, status: { in: [...DESIGN_VISIBLE_PROJECT_STATUSES] } },
      OR: [{ site_id: session.site_id }, { site_id: null, project: { site_id: session.site_id } }],
      ...(opts.mine ? { assignee_id: actor.userId } : {}),
    },
    select: SITE_TASK_SELECT,
    orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { sort_order: 'asc' }, { created_at: 'asc' }],
    take: SITE_TASKS_LIMIT,
  });
  return rows.map((r) => projectSiteTask(r, actor.userId));
}
