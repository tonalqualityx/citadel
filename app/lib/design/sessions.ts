/**
 * Designer Portal: the session engine (design sections 6, 7.1 POST /sessions, 8.7).
 *
 * Pure services, no route handlers. Three things live here:
 *  - SESSION_TRANSITIONS / transition(): the section 8.7 state machine as a table, enforced by `transition()`
 *    (pure) and `transitionSession()` (compare and set on the row).
 *  - createOrGetSession(): idempotent per task under pg_advisory_xact_lock, one live session per task (the
 *    partial unique index design_sessions_one_live_per_task is the backstop), claims the task with holder
 *    `design:<task8>` in the same transaction.
 *  - closeSession(): picks closed vs abandoned and releases the task claim.
 * Timer logic (D10) is W2.7's and is not here.
 */
import type { DesignSession, DesignSessionStatus, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { claimTask, releaseClaim } from '@/lib/tasks/claims';
import { DRAWER_TASK_SELECT, designerOnProject, drawerDecision, DESIGN_TERMINAL_SESSION_STATUSES, type DrawerDecision, type DrawerTask } from './access';
import { designClaimHolder, isUuid, task8, type DesignActor } from './helpers';

export type SessionActor = 'worker' | 'server';

export const SESSION_STATUSES: readonly DesignSessionStatus[] = [
  'pending', 'active', 'awaiting_input', 'paused_budget', 'stopped', 'publishing', 'closed', 'abandoned',
];

/** Who may make each move (design 8.7). Anything not listed is illegal. */
export const SESSION_TRANSITIONS: Readonly<Record<DesignSessionStatus, Readonly<Partial<Record<DesignSessionStatus, readonly SessionActor[]>>>>> = {
  pending: { awaiting_input: ['worker'], stopped: ['worker'] },
  active: { awaiting_input: ['worker'], paused_budget: ['worker', 'server'] },
  awaiting_input: {
    active: ['worker'],
    stopped: ['worker'],
    paused_budget: ['worker', 'server'],
    publishing: ['server'],
    closed: ['worker'],
    abandoned: ['worker'],
  },
  paused_budget: { awaiting_input: ['worker'], closed: ['worker'], abandoned: ['worker'] },
  stopped: { awaiting_input: ['worker'], closed: ['worker'], abandoned: ['worker'] },
  publishing: { awaiting_input: ['server'] },
  closed: {},
  abandoned: {},
};

export function isTerminalStatus(s: DesignSessionStatus): boolean {
  return (DESIGN_TERMINAL_SESSION_STATUSES as readonly string[]).includes(s);
}

export function legalTargets(from: DesignSessionStatus): DesignSessionStatus[] {
  return Object.keys(SESSION_TRANSITIONS[from]) as DesignSessionStatus[];
}

/**
 * Pure check of one move. Returns `to` when legal; throws a 409 `illegal_transition` otherwise. When `by` is
 * given the actor must be one the table allows for that move.
 */
export function transition(session: { status: DesignSessionStatus }, to: DesignSessionStatus, by?: SessionActor): DesignSessionStatus {
  const allowed = SESSION_TRANSITIONS[session.status]?.[to];
  if (!allowed) throw new ApiError(`Session cannot move from ${session.status} to ${to}`, 409, 'illegal_transition');
  if (by && !allowed.includes(by)) throw new ApiError(`${by} may not move a session from ${session.status} to ${to}`, 409, 'illegal_transition');
  return to;
}

type Db = PrismaClient;

/** Release the task claim a session holds (holder `design:<task8>`), using the token stored on the task. */
async function releaseSessionClaim(db: Pick<PrismaClient, 'task' | '$executeRaw'>, taskId: string): Promise<boolean> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { claim_holder: true, claim_token: true } });
  if (!t || t.claim_holder !== designClaimHolder(taskId) || !t.claim_token) return false;
  return releaseClaim({ taskId, token: t.claim_token }, db as never);
}

/**
 * Move a session along the table as a compare and set (`WHERE status = <from>`): a concurrent mover loses
 * with a 409. Terminal moves stamp closed_at and release the task claim in the same transaction.
 */
export async function transitionSession(
  sessionId: string,
  to: DesignSessionStatus,
  by: SessionActor,
  extra: { data?: Partial<Pick<DesignSession, 'last_turn_at' | 'live_text' | 'live_action'>> } = {},
  db: Db = defaultDb,
): Promise<DesignSession> {
  if (!isUuid(sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  return db.$transaction(async (tx) => {
    const current = await tx.designSession.findUnique({ where: { id: sessionId } });
    if (!current) throw new ApiError('Session not found', 404, 'not_found');
    transition(current, to, by);
    const res = await tx.designSession.updateMany({
      where: { id: sessionId, status: current.status },
      data: { ...(extra.data ?? {}), status: to, ...(isTerminalStatus(to) ? { closed_at: new Date() } : {}) },
    });
    if (res.count !== 1) throw new ApiError('Session changed state; reload and retry', 409, 'state_conflict');
    if (isTerminalStatus(to)) await releaseSessionClaim(tx as unknown as Db, current.task_id);
    return tx.designSession.findUniqueOrThrow({ where: { id: sessionId } });
  });
}

/** closed when at least one publish of the session succeeded, abandoned otherwise (design 6 enum comments). */
export async function terminalStatusFor(sessionId: string, db: Pick<PrismaClient, 'designPublish'> = defaultDb): Promise<'closed' | 'abandoned'> {
  const n = await db.designPublish.count({ where: { session_id: sessionId, kind: 'publish', status: { in: ['published', 'rolled_back'] } } });
  return n > 0 ? 'closed' : 'abandoned';
}

/** The worker's close: closed or abandoned by publish history; releases the claim. Idempotent on a terminal session. */
export async function closeSession(sessionId: string, db: Db = defaultDb): Promise<DesignSession> {
  const s = await db.designSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new ApiError('Session not found', 404, 'not_found');
  if (isTerminalStatus(s.status)) return s;
  return transitionSession(sessionId, await terminalStatusFor(sessionId, db), 'worker', {}, db);
}

export interface SessionDefaults {
  enabled: boolean;
  budget_usd: number;
  model: string;
  effort: string;
}

export const SESSION_DEFAULTS = { budget_usd: 25, model: 'opus', effort: 'high' } as const;

export async function loadSessionDefaults(db: Pick<PrismaClient, 'designPortalSettings'> = defaultDb): Promise<SessionDefaults> {
  const s = await db.designPortalSettings.findUnique({ where: { id: 1 } });
  if (!s) return { enabled: false, ...SESSION_DEFAULTS };
  return { enabled: s.enabled, budget_usd: Number(s.default_session_budget_usd.toString()), model: s.model, effort: s.effort };
}

export const CLAIM_TTL_SECONDS = 1800;

export interface CreateOrGetResult {
  session: DesignSession;
  created: boolean;
}

/**
 * POST /api/design/sessions in one transaction.
 *  - `pg_advisory_xact_lock(hashtext('design-session:'||task_id))` serializes creators, so a double click (or
 *    two tabs) yields one session; the partial unique index is the backstop.
 *  - an existing live session returns as is (created: false) and renews the claim. For a designer that is her
 *    own session only while she is still on its project (W8.2 H2: 404 once she is removed). Another
 *    designer's live session is 409 `session_owned` only when the task is in this designer's drawer (she is
 *    on the project, so the drawer already shows her the task and its session chip); otherwise 404, so task
 *    ids cannot be probed (W8.2 H6, T10). An admin may open any live session.
 *  - a new session needs: the kill switch on (409 portal_disabled), the task passing the drawer filter for this
 *    caller (404; claimed by someone else is 409 task_claimed), the site served by the box (409
 *    site_not_available), and the task claim (holder `design:<task8>`); the claim is taken inside the
 *    transaction, so a lost claim rolls the session back.
 */
export async function createOrGetSession(actor: DesignActor, taskId: string, db: Db = defaultDb): Promise<CreateOrGetResult> {
  if (!isUuid(taskId)) throw new ApiError('Task not found', 404, 'not_found');
  if (actor.role !== 'designer' && actor.role !== 'admin') throw new ApiError('Forbidden', 403, 'forbidden');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-session:${taskId}`}))`;
    const holder = designClaimHolder(taskId);

    /** The drawer filter for this caller (null when the task does not exist). */
    const decide = async (): Promise<{ task: DrawerTask; decision: DrawerDecision } | null> => {
      const task = await tx.task.findUnique({ where: { id: taskId }, select: DRAWER_TASK_SELECT });
      if (!task) return null;
      const assigned = actor.role === 'designer'
        ? (await tx.projectTeamAssignment.findMany({ where: { user_id: actor.userId }, select: { project_id: true } })).map((a) => a.project_id)
        : [];
      const state = await tx.designWorkerState.findUnique({ where: { id: 1 }, select: { configured_site_ids: true } });
      const decision = drawerDecision(task as DrawerTask, { actor, assignedProjectIds: assigned, configuredSiteIds: state?.configured_site_ids ?? [] });
      return { task: task as DrawerTask, decision };
    };

    const live = await tx.designSession.findFirst({ where: { task_id: taskId, status: { notIn: ['closed', 'abandoned'] } } });
    if (live) {
      if (actor.role !== 'admin') {
        if (live.designer_id === actor.userId) {
          if (!(await designerOnProject(actor.userId, live.project_id, tx as unknown as Db))) throw new ApiError('Task not found', 404, 'not_found');
        } else {
          const seen = await decide();
          if (!seen?.decision.listed) throw new ApiError('Task not found', 404, 'not_found');
          throw new ApiError('Another designer has this task open', 409, 'session_owned');
        }
      }
      await claimTask({ taskId, holder, ttlSeconds: CLAIM_TTL_SECONDS }, tx as unknown as Db);
      return { session: live, created: false };
    }

    const defaults = await loadSessionDefaults(tx);
    if (!defaults.enabled) throw new ApiError('The designer portal is switched off', 409, 'portal_disabled');

    const seen = await decide();
    if (!seen) throw new ApiError('Task not found', 404, 'not_found');
    const { task, decision } = seen;
    if (!decision.listed) {
      if (decision.reason === 'claimed_elsewhere') throw new ApiError('Someone else is working on this task', 409, 'task_claimed');
      throw new ApiError('Task not found', 404, 'not_found');
    }
    if (!decision.available) throw new ApiError('This site is not available yet', 409, 'site_not_available');

    const claim = await claimTask({ taskId, holder, ttlSeconds: CLAIM_TTL_SECONDS }, tx as unknown as Db);
    if (!claim.ok) {
      if (claim.reason === 'taken') throw new ApiError('Someone else is working on this task', 409, 'task_claimed');
      throw new ApiError('Task not found', 404, 'not_found');
    }

    const t8 = task8(taskId);
    const session = await tx.designSession.create({
      data: {
        task_id: taskId,
        site_id: decision.site.id,
        project_id: task.project_id,
        designer_id: actor.userId,
        status: 'pending',
        branch: `design/${t8}`,
        preview_alias: `design-${t8}`,
        model: defaults.model,
        effort: defaults.effort,
        budget_usd: defaults.budget_usd,
      },
    });
    return { session, created: true };
  });
}
