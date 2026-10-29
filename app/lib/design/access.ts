/**
 * Designer Portal: who sees which task and which session (design sections 3 step 2, 5 D1, 7.1, 7.2).
 *
 * The drawer (GET /api/design/tasks) lists a task when ALL of these hold:
 *  (a) a designer is on the task's project through a ProjectTeamAssignment (admin and pm skip this test:
 *      "Admin/pm see every enabled site's open tasks"); a task with no project is never listed, because the
 *      drawer groups by project;
 *  (b) the task is open: not deleted and status not `done`/`abandoned` (design step 2, the same rule as
 *      lib/tasks/claims.ts; `blocked`, `review` and the rest stay listed with their status chip);
 *  (c) the project is not deleted and its status shows tasks to assignees: `ready | in_progress | review`;
 *  (d) the site (`task.site_id ?? project.site_id`) is not deleted, has `design_portal_enabled = true` and
 *      `site_type = eleventy`;
 *  (e) nobody but this task's own design session holds a live claim on it (`claim_holder` other than
 *      `design:<task8>` with `lease_until` in the future): session creation would fail to claim it, so the
 *      drawer does not offer it. Not in the design text; W2.1's choice.
 * A listed task whose site is not in `DesignWorkerState.configured_site_ids` (the box does not serve it) is
 * still listed, with `available = false` ("not available yet"); session creation refuses it (409).
 *
 * Sessions: the session's designer and admins read and write; a pm reads (7.1 "pm (read)", 7.2 lists) and
 * gets 403 on writes (the pm can see the session, so 403 leaks nothing); everyone else gets 404, never 403,
 * so ids cannot be probed (7.1 preamble, T10).
 */
import type { DesignSession, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { designClaimHolder, isUuid, type DesignActor } from './helpers';

export const DESIGN_CLOSED_TASK_STATUSES = ['done', 'abandoned'] as const;
export const DESIGN_VISIBLE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
export const DESIGN_SITE_TYPE = 'eleventy';
export const DESIGN_TERMINAL_SESSION_STATUSES = ['closed', 'abandoned'] as const;

// ---------------------------------------------------------------------------------------------------------
// Drawer filter (pure)
// ---------------------------------------------------------------------------------------------------------

export interface DrawerSite {
  id: string;
  name: string;
  site_type: string | null;
  design_portal_enabled: boolean;
  is_deleted: boolean;
}

export interface DrawerTask {
  id: string;
  title: string;
  status: string;
  is_deleted: boolean;
  sort_order: number;
  phase: string | null;
  project_phase: { id: string; name: string; sort_order: number } | null;
  site_id: string | null;
  site: DrawerSite | null;
  project_id: string | null;
  project: {
    id: string;
    name: string;
    status: string;
    is_deleted: boolean;
    site_id: string | null;
    site: DrawerSite | null;
  } | null;
  claim_holder: string | null;
  lease_until: Date | null;
}

export type DrawerExclusion =
  | 'role_not_allowed'
  | 'task_deleted'
  | 'task_closed'
  | 'no_project'
  | 'project_deleted'
  | 'project_hidden'
  | 'not_assigned'
  | 'no_site'
  | 'site_deleted'
  | 'site_disabled'
  | 'site_not_eleventy'
  | 'claimed_elsewhere';

export type DrawerDecision =
  | { listed: true; site: DrawerSite; available: boolean }
  | { listed: false; reason: DrawerExclusion };

export interface DrawerContext {
  actor: Pick<DesignActor, 'userId' | 'role'>;
  /** Project ids the actor is on through ProjectTeamAssignment (only read for a designer). */
  assignedProjectIds: Iterable<string>;
  /** DesignWorkerState.configured_site_ids: the sites the box serves. */
  configuredSiteIds: Iterable<string>;
  now?: Date;
}

/** The drawer is readable by designers, admins and pms (7.1). */
export function canReadDrawer(role: string): boolean {
  return role === 'designer' || role === 'admin' || role === 'pm';
}

/** `task.site_id ?? project.site_id`: the task's own site wins whenever the task names one. */
export function effectiveSite(task: Pick<DrawerTask, 'site_id' | 'site' | 'project'>): DrawerSite | null {
  if (task.site_id) return task.site;
  return task.project?.site ?? null;
}

export function drawerDecision(task: DrawerTask, ctx: DrawerContext): DrawerDecision {
  const { actor } = ctx;
  if (!canReadDrawer(actor.role)) return { listed: false, reason: 'role_not_allowed' };
  if (task.is_deleted) return { listed: false, reason: 'task_deleted' };
  if ((DESIGN_CLOSED_TASK_STATUSES as readonly string[]).includes(task.status)) return { listed: false, reason: 'task_closed' };
  if (!task.project_id || !task.project) return { listed: false, reason: 'no_project' };
  if (task.project.is_deleted) return { listed: false, reason: 'project_deleted' };
  if (!(DESIGN_VISIBLE_PROJECT_STATUSES as readonly string[]).includes(task.project.status)) return { listed: false, reason: 'project_hidden' };
  if (actor.role === 'designer' && !new Set(ctx.assignedProjectIds).has(task.project_id)) return { listed: false, reason: 'not_assigned' };
  const site = effectiveSite(task);
  if (!site) return { listed: false, reason: 'no_site' };
  if (site.is_deleted) return { listed: false, reason: 'site_deleted' };
  if (!site.design_portal_enabled) return { listed: false, reason: 'site_disabled' };
  if (site.site_type !== DESIGN_SITE_TYPE) return { listed: false, reason: 'site_not_eleventy' };
  const now = ctx.now ?? new Date();
  if (task.claim_holder && task.lease_until && task.lease_until > now && task.claim_holder !== designClaimHolder(task.id)) {
    return { listed: false, reason: 'claimed_elsewhere' };
  }
  return { listed: true, site, available: new Set(ctx.configuredSiteIds).has(site.id) };
}

export interface DrawerRow {
  task: DrawerTask;
  site: DrawerSite;
  available: boolean;
}

export function filterDrawerTasks(tasks: readonly DrawerTask[], ctx: DrawerContext): DrawerRow[] {
  const assigned = new Set(ctx.assignedProjectIds);
  const configured = new Set(ctx.configuredSiteIds);
  const fixed: DrawerContext = { ...ctx, assignedProjectIds: assigned, configuredSiteIds: configured };
  const rows: DrawerRow[] = [];
  for (const task of tasks) {
    const d = drawerDecision(task, fixed);
    if (d.listed) rows.push({ task, site: d.site, available: d.available });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// Drawer query (the DB pre-filter; filterDrawerTasks re-checks every row)
// ---------------------------------------------------------------------------------------------------------

const DRAWER_SITE_SELECT = { id: true, name: true, site_type: true, design_portal_enabled: true, is_deleted: true } as const;

/** Only what the drawer needs: no estimate, billing, time, assignee, client or description field is read. */
export const DRAWER_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  is_deleted: true,
  sort_order: true,
  phase: true,
  project_phase: { select: { id: true, name: true, sort_order: true } },
  site_id: true,
  site: { select: DRAWER_SITE_SELECT },
  project_id: true,
  project: { select: { id: true, name: true, status: true, is_deleted: true, site_id: true, site: { select: DRAWER_SITE_SELECT } } },
  claim_holder: true,
  lease_until: true,
} satisfies Prisma.TaskSelect;

const ENABLED_SITE_WHERE = { is_deleted: false, design_portal_enabled: true, site_type: DESIGN_SITE_TYPE } satisfies Prisma.SiteWhereInput;

export function drawerTaskWhere(
  actor: Pick<DesignActor, 'role'>,
  assignedProjectIds: readonly string[],
  projectId?: string | null,
): Prisma.TaskWhereInput {
  const projectIds = actor.role === 'designer' ? assignedProjectIds.filter((id) => !projectId || id === projectId) : null;
  return {
    is_deleted: false,
    status: { notIn: [...DESIGN_CLOSED_TASK_STATUSES] },
    project_id: projectIds ? { in: projectIds } : projectId ? projectId : { not: null },
    project: { is_deleted: false, status: { in: [...DESIGN_VISIBLE_PROJECT_STATUSES] } },
    OR: [{ site: ENABLED_SITE_WHERE }, { site_id: null, project: { site: ENABLED_SITE_WHERE } }],
  };
}

export interface DrawerSessionRow {
  id: string;
  task_id: string;
  designer_id: string;
  status: string;
  publish_requested_at: Date | null;
  last_publish_id: string | null;
  created_at: Date;
}

export interface DrawerData {
  rows: DrawerRow[];
  /** The latest session per listed task (any status, so a closed one still shows its chip). */
  sessionsByTask: Map<string, DrawerSessionRow>;
  /** finished_at of each session's last publish, by publish id (for the "published <date>" chip). */
  publishedAt: Map<string, Date | null>;
  worker: { last_heartbeat_at: Date | null; paused: boolean };
}

type DrawerDb = Pick<PrismaClient, 'projectTeamAssignment' | 'task' | 'designWorkerState' | 'designSession' | 'designPublish'>;

export async function loadDrawer(
  actor: DesignActor,
  opts: { projectId?: string | null; now?: Date } = {},
  db: DrawerDb = defaultDb,
): Promise<DrawerData> {
  if (!canReadDrawer(actor.role)) throw new ApiError('Forbidden', 403, 'forbidden');
  const projectId = opts.projectId && isUuid(opts.projectId) ? opts.projectId : null;
  if (opts.projectId && !projectId) {
    return { rows: [], sessionsByTask: new Map(), publishedAt: new Map(), worker: { last_heartbeat_at: null, paused: false } };
  }

  const assigned =
    actor.role === 'designer'
      ? (await db.projectTeamAssignment.findMany({ where: { user_id: actor.userId }, select: { project_id: true } })).map((a) => a.project_id)
      : [];

  const [tasks, state] = await Promise.all([
    actor.role === 'designer' && assigned.length === 0
      ? Promise.resolve([] as DrawerTask[])
      : db.task.findMany({
          where: drawerTaskWhere(actor, assigned, projectId),
          select: DRAWER_TASK_SELECT,
          orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        }),
    db.designWorkerState.findUnique({ where: { id: 1 }, select: { configured_site_ids: true, last_heartbeat_at: true, paused: true } }),
  ]);

  const rows = filterDrawerTasks(tasks as DrawerTask[], {
    actor,
    assignedProjectIds: assigned,
    configuredSiteIds: state?.configured_site_ids ?? [],
    now: opts.now,
  });

  const sessionsByTask = new Map<string, DrawerSessionRow>();
  const publishedAt = new Map<string, Date | null>();
  if (rows.length > 0) {
    const sessions = await db.designSession.findMany({
      where: { task_id: { in: rows.map((r) => r.task.id) } },
      select: { id: true, task_id: true, designer_id: true, status: true, publish_requested_at: true, last_publish_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
    for (const s of sessions) if (!sessionsByTask.has(s.task_id)) sessionsByTask.set(s.task_id, s);
    const publishIds = [...sessionsByTask.values()].map((s) => s.last_publish_id).filter((id): id is string => !!id);
    if (publishIds.length > 0) {
      const pubs = await db.designPublish.findMany({ where: { id: { in: publishIds }, status: 'published' }, select: { id: true, finished_at: true } });
      for (const p of pubs) publishedAt.set(p.id, p.finished_at);
    }
  }

  return { rows, sessionsByTask, publishedAt, worker: { last_heartbeat_at: state?.last_heartbeat_at ?? null, paused: state?.paused ?? false } };
}

// ---------------------------------------------------------------------------------------------------------
// Session access
// ---------------------------------------------------------------------------------------------------------

export type SessionAccessMode = 'read' | 'write';
export type AccessVerdict = 'ok' | 'not_found' | 'forbidden';

/**
 * admin: read and write every session. designer: only her own (designer_id), else 404. pm: read every
 * session, 403 on writes. tech and anyone else: 404.
 */
export function sessionAccess(
  actor: Pick<DesignActor, 'userId' | 'role'>,
  session: { designer_id: string },
  mode: SessionAccessMode,
): AccessVerdict {
  if (actor.role === 'admin') return 'ok';
  if (actor.role === 'designer') return session.designer_id === actor.userId ? 'ok' : 'not_found';
  if (actor.role === 'pm') return mode === 'read' ? 'ok' : 'forbidden';
  return 'not_found';
}

export function throwForVerdict(verdict: AccessVerdict, what: string): void {
  if (verdict === 'not_found') throw new ApiError(`${what} not found`, 404, 'not_found');
  if (verdict === 'forbidden') throw new ApiError('Forbidden', 403, 'forbidden');
}

type SessionDb = Pick<PrismaClient, 'designSession'>;

/**
 * Load a session the caller may see, or throw: 404 for a malformed id, a missing row, or a session that is
 * not the caller's (another designer, tech); 403 for a pm asking to write. The row is the full record:
 * project it with projections.ts before it leaves the server.
 */
export async function loadSessionFor(
  actor: DesignActor,
  id: string,
  opts: { mode?: SessionAccessMode } = {},
  db: SessionDb = defaultDb,
): Promise<DesignSession> {
  if (!isUuid(id)) throw new ApiError('Session not found', 404, 'not_found');
  const session = await db.designSession.findUnique({ where: { id } });
  if (!session) throw new ApiError('Session not found', 404, 'not_found');
  throwForVerdict(sessionAccess(actor, session, opts.mode ?? 'read'), 'Session');
  return session;
}

/**
 * The "my sessions" list (GET /api/design/sessions, 7.1 "designer (own), admin"): a designer sees her own,
 * an admin sees all. pm and tech get null (the route answers 403; a pm uses the admin list).
 */
export function mySessionsWhere(actor: Pick<DesignActor, 'userId' | 'role'>): Prisma.DesignSessionWhereInput | null {
  if (actor.role === 'designer') return { designer_id: actor.userId };
  if (actor.role === 'admin') return {};
  return null;
}

/** The admin overview lists (7.2 GET admin/sessions and admin/publishes): admin and pm. */
export function canReadAdminLists(role: string): boolean {
  return role === 'admin' || role === 'pm';
}

/** The publish page (GET /api/design/publishes/:id): admin, pm, or the session's designer; else 404. */
export function publishPageAccess(
  actor: Pick<DesignActor, 'userId' | 'role'>,
  session: { designer_id: string },
): AccessVerdict {
  if (actor.role === 'admin' || actor.role === 'pm') return 'ok';
  if (actor.role === 'designer' && session.designer_id === actor.userId) return 'ok';
  return 'not_found';
}
