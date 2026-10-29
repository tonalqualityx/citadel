/**
 * Designer Portal: publish and rollback on the server side (design 4.3, 5 D5, 6 invariant 6, 7.1, 7.3, 8.10).
 *
 * Who may do what is decided in publish-policy.ts (pure); this module loads the rows, applies those rules,
 * and owns the DesignPublish status machine:
 *
 *   awaiting_confirmation -> queued | expired          server only (confirm route; a newer intent or the TTL)
 *   queued  -> running | failed | blocked_gates | conflict   worker (PATCH worker/publishes/:id)
 *   running -> published | failed | blocked_gates | conflict worker
 *   published -> rolled_back                           server only (when a rollback of it is published)
 *
 * Forward only: nothing ever moves back, `expired`, `failed`, `blocked_gates`, `conflict` and `rolled_back`
 * are final, and `blocked_policy` is never entered (Mike's 2026-10-28 ruling: no content or code policy).
 *
 * The `published` transaction (completePublish) writes, in ONE transaction: the publish fields; for a
 * rollback the target `rolled_back`; the session back to `awaiting_input` (base_sha = result_sha for a
 * publish) with last_publish_id; one internal Comment on the task by the design-worker service user
 * (actor_lane design-worker); and on a production site one TaskReceipt(live) through writeReceipt() with
 * approval_source design_publish:<id> / design_admin_publish:<id> / design_rollback:<id>, or for a publish or
 * rollback made with an admin's design:operator-publish key (actor_via 'operator_key', lib/design/operator.ts)
 * design_operator_publish:<id> / design_operator_rollback:<id>. The FYI
 * notification goes out through the repo dispatcher right after the commit (the dispatcher writes with the
 * global client and may send email, so it cannot join the transaction); notified_at records it.
 * Task.staging_* and the task's status are never touched: they bind the client approval loop.
 */
import { Prisma, type DesignPublish, type DesignPublishStatus, type DesignSession, type NotificationPriority, type PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { cleanApprovalSource, writeReceipt, type CheckEntry } from '@/lib/portal/receipts';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { createCommand } from './commands';
import { transition } from './sessions';
import { currentSessionAccess, designerOnProject, loadSessionFor, publishPageAccess } from './access';
import { DESIGN_WORKER_LANE, DESIGN_WORKER_SERVICE_EMAIL, displayHost, isUuid, toUsd, type DesignActor } from './helpers';
import { operatorPhrase } from './operator';
import {
  actorViaOf,
  canPublish,
  canRequestPublish,
  canRollback,
  checkConfirmation,
  confirmationShown,
  designerMayPublish,
  gateStatus,
  hashConfirmationToken,
  latestPublishedQuery,
  mainRoleFor,
  newConfirmationToken,
  normalizeMainRole,
  normalizePublishMode,
  parsePrecheck,
  refuse,
  type ConfirmationShown,
  type DesignerRollbackStanding,
  type MainRole,
  type PolicyRefusal,
} from './publish-policy';
import { projectPublishPage, projectSession } from './projections';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------------------------------------

export type PublishMover = 'worker' | 'server';

/** Every legal move and who may make it. Anything not listed is illegal (forward only). */
export const PUBLISH_TRANSITIONS: Readonly<Record<DesignPublishStatus, Readonly<Partial<Record<DesignPublishStatus, readonly PublishMover[]>>>>> = {
  awaiting_confirmation: { queued: ['server'], expired: ['server'] },
  expired: {},
  queued: { running: ['worker'], failed: ['worker'], blocked_gates: ['worker'], conflict: ['worker'] },
  running: { published: ['worker'], failed: ['worker'], blocked_gates: ['worker'], conflict: ['worker'] },
  published: { rolled_back: ['server'] },
  blocked_gates: {},
  blocked_policy: {},
  conflict: {},
  failed: {},
  rolled_back: {},
};

/** What PATCH worker/publishes/:id may set (7.3). */
export const WORKER_PUBLISH_STATUSES = ['running', 'published', 'blocked_gates', 'conflict', 'failed'] as const;
export type WorkerPublishStatus = (typeof WORKER_PUBLISH_STATUSES)[number];
export const FINAL_PUBLISH_STATUSES: readonly DesignPublishStatus[] = ['expired', 'published', 'blocked_gates', 'blocked_policy', 'conflict', 'failed', 'rolled_back'];
const LIVE_PUBLISH_STATUSES: DesignPublishStatus[] = ['queued', 'running'];

export function isLegalPublishMove(from: DesignPublishStatus, to: DesignPublishStatus, by: PublishMover): boolean {
  return !!PUBLISH_TRANSITIONS[from]?.[to]?.includes(by);
}

/** Throws a 409 `illegal_transition` unless `by` may move a publish from `from` to `to`. */
export function assertPublishMove(from: DesignPublishStatus, to: DesignPublishStatus, by: PublishMover): void {
  if (!isLegalPublishMove(from, to, by)) {
    throw new ApiError(`A publish cannot move from ${from} to ${to}${by === 'worker' ? ' from the worker' : ''}`, 409, 'illegal_transition');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------

/** A policy refusal with optional details (the gate output on a red precheck). */
export class DesignPolicyError extends ApiError {
  constructor(message: string, statusCode: number, code: string, public details?: Record<string, unknown>) {
    super(message, statusCode, code);
    this.name = 'DesignPolicyError';
  }
}

function fail(r: PolicyRefusal, details?: Record<string, unknown>): never {
  throw new DesignPolicyError(r.message, r.status, r.code, details);
}

/** The routes' catch: a policy refusal keeps its code and details; everything else goes to handleApiError. */
export function designErrorResponse(error: unknown): NextResponse {
  if (error instanceof DesignPolicyError) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.details ?? {}) }, { status: error.statusCode });
  }
  return handleApiError(error);
}

/** Refusals about WHO is asking come before the kill switch, so a pm or an API key is told 403 either way. */
const ACTOR_CODES = new Set(['session_required', 'forbidden', 'not_found']);

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ---------------------------------------------------------------------------------------------------------
// Shared loading
// ---------------------------------------------------------------------------------------------------------

const SITE_SELECT = {
  id: true, name: true, url: true, prod_branch: true, repo_branch: true, design_portal_enabled: true, designer_publish: true, is_deleted: true,
} as const;

interface PublishSite {
  id: string;
  name: string;
  url: string | null;
  prod_branch: string | null;
  repo_branch: string | null;
  design_portal_enabled: boolean;
  designer_publish: boolean;
  is_deleted: boolean;
}

interface PublishSettings {
  enabled: boolean;
  owner_user_id: string | null;
  designer_publish_mode: string;
  confirmation_ttl_minutes: number;
}

interface PublishContext {
  site: PublishSite;
  settings: PublishSettings | null;
  mainRole: MainRole;
  liveUrl: string | null;
}

/** DesignWorkerState.site_live_urls ({"<site id>": "https://..."}) for one site. */
export function liveUrlFor(siteId: string, siteLiveUrls: unknown): string | null {
  if (siteLiveUrls && typeof siteLiveUrls === 'object' && !Array.isArray(siteLiveUrls)) {
    const v = (siteLiveUrls as Record<string, unknown>)[siteId];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

async function loadContext(db: Db | Tx, siteId: string): Promise<PublishContext> {
  const [site, settings, worker] = await Promise.all([
    db.site.findUnique({ where: { id: siteId }, select: SITE_SELECT }),
    db.designPortalSettings.findUnique({
      where: { id: 1 },
      select: { enabled: true, owner_user_id: true, designer_publish_mode: true, confirmation_ttl_minutes: true },
    }),
    db.designWorkerState.findUnique({ where: { id: 1 }, select: { site_main_roles: true, site_live_urls: true } }),
  ]);
  if (!site) throw new ApiError('Session not found', 404, 'not_found');
  return { site, settings, mainRole: mainRoleFor(site.id, worker?.site_main_roles), liveUrl: liveUrlFor(site.id, worker?.site_live_urls) };
}

/** A missing settings row is the kill switch off; its mode then reads as `off` (fail closed). */
function policySettings(ctx: PublishContext) {
  return { designer_publish_mode: ctx.settings?.designer_publish_mode ?? 'off' };
}

function requireEnabled(ctx: PublishContext): void {
  if (!ctx.settings?.enabled) throw new ApiError('The designer portal is switched off', 409, 'portal_disabled');
}

async function sitePublishRunning(db: Db | Tx, siteId: string, exceptId?: string): Promise<boolean> {
  const n = await db.designPublish.count({
    where: { site_id: siteId, status: { in: LIVE_PUBLISH_STATUSES }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  return n > 0;
}

/**
 * The policy view of a session: the row plus whether its designer is on its project right now (W8.2 H2).
 * Only a designer actor's rights read the flag, so other actors skip the query.
 */
async function withStanding<S extends { designer_id: string; project_id: string | null }>(
  actor: Pick<DesignActor, 'role'>,
  session: S,
  db: Db | Tx,
): Promise<S & { designer_on_project: boolean }> {
  const onProject = actor.role === 'designer' ? await designerOnProject(session.designer_id, session.project_id, db) : false;
  return { ...session, designer_on_project: onProject };
}

/** A designer's standing for the "her publish" rollback path (W8.2 H2, H4, N4); undefined for other roles. */
async function rollbackStanding(
  actor: DesignActor,
  session: { designer_id: string; project_id: string | null } | null,
  ctx: PublishContext,
  db: Db | Tx,
): Promise<DesignerRollbackStanding | undefined> {
  if (actor.role !== 'designer') return undefined;
  return {
    has_session_access: !!session && (await currentSessionAccess(actor, session, 'write', db)) === 'ok',
    may_publish: designerMayPublish(ctx.site, policySettings(ctx), ctx.mainRole),
  };
}

function shownOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function clampTtl(minutes: number | null | undefined): number {
  const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.trunc(minutes) : 10;
  return Math.min(60, Math.max(1, m));
}

// ---------------------------------------------------------------------------------------------------------
// Step 1: intent (POST /api/design/sessions/:id/publish)
// ---------------------------------------------------------------------------------------------------------

export interface PublishIntentResult {
  publish_id: string;
  confirmation_token: string;
  expires_at: Date;
  shown: ConfirmationShown;
}

/**
 * The actor rule and the D5 state pre-conditions (canPublish), the kill switch, then one transaction that
 * expires the session's earlier unconfirmed intents and creates the `awaiting_confirmation` row holding
 * exactly what the dialog shows. The token is returned here once; only its sha256 is stored.
 */
export async function createPublishIntent(
  actor: DesignActor,
  sessionId: string,
  headSha: string,
  opts: { now?: Date } = {},
  db: Db = defaultDb,
): Promise<PublishIntentResult> {
  const session = await withStanding(actor, await loadSessionFor(actor, sessionId, { mode: 'read' }, db), db);
  const ctx = await loadContext(db, session.site_id);
  const decision = canPublish(actor, session, ctx.site, policySettings(ctx), ctx.mainRole, {
    head_sha: headSha,
    publishRunning: await sitePublishRunning(db, ctx.site.id),
  });
  if (!decision.ok && ACTOR_CODES.has(decision.code)) fail(decision);
  requireEnabled(ctx);
  if (!decision.ok) {
    const p = parsePrecheck(session.publish_precheck);
    fail(decision, decision.code === 'gates_not_green' ? { gates: p?.gates ?? [], precheck_head_sha: p?.head_sha ?? null, head_sha: session.head_sha } : undefined);
  }

  const changes = await db.designChange.findMany({
    where: { session_id: session.id, decision: { not: 'denied' } },
    select: { pages: true, files: true },
    orderBy: { created_at: 'asc' },
  });
  const shown = confirmationShown({ site: ctx.site, mainRole: ctx.mainRole, liveUrl: ctx.liveUrl, session, changes });
  const token = newConfirmationToken();
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + clampTtl(ctx.settings?.confirmation_ttl_minutes) * 60_000);

  const row = await db.$transaction(async (tx) => {
    await tx.designPublish.updateMany({
      where: { session_id: session.id, status: 'awaiting_confirmation' },
      data: { status: 'expired', confirmation_token_hash: null },
    });
    return tx.designPublish.create({
      data: {
        session_id: session.id,
        site_id: ctx.site.id,
        task_id: session.task_id,
        kind: 'publish',
        actor_id: actor.userId,
        actor_role: decision.actor_role,
        actor_via: actorViaOf(actor),
        actor_api_key_id: actorViaOf(actor) === 'operator_key' ? (actor.apiKeyId ?? null) : null,
        publish_mode: decision.publish_mode,
        main_role: decision.main_role,
        site_designer_publish: decision.site_designer_publish,
        confirmation_shown: shown as unknown as Prisma.InputJsonValue,
        confirmation_token_hash: hashConfirmationToken(token),
        confirmation_expires_at: expiresAt,
        confirm_requested_at: now,
        status: 'awaiting_confirmation',
        head_sha: session.head_sha,
        diff_summary: (session.diff_summary ?? Prisma.DbNull) as Prisma.InputJsonValue,
        cost_usd: session.cost_usd,
      },
      select: { id: true },
    });
  });
  return { publish_id: row.id, confirmation_token: token, expires_at: expiresAt, shown };
}

// ---------------------------------------------------------------------------------------------------------
// Step 2: confirm (POST /api/design/publishes/:id/confirm)
// ---------------------------------------------------------------------------------------------------------

/**
 * Same actor (404 otherwise), both fields (400), then 409 for a used, expired or wrong token, a typed name
 * that is not the shown main branch, a moved head, gates no longer green, a changed main_role or live URL,
 * the actor rule now failing, or another publish queued or running on the site. On success, in ONE
 * transaction: the token is consumed, the row goes `queued` with confirmed_at, the DesignCommand(publish)
 * is created and the session moves to `publishing`.
 */
export async function confirmPublish(
  actor: DesignActor,
  publishId: string,
  input: { confirmation_token?: string | null; typed_confirmation?: string | null },
  opts: { now?: Date } = {},
  db: Db = defaultDb,
): Promise<{ publish_id: string }> {
  if (!isUuid(publishId)) throw new ApiError('Publish not found', 404, 'not_found');
  const publish = await db.designPublish.findUnique({ where: { id: publishId } });
  if (!publish || publish.kind !== 'publish') throw new ApiError('Publish not found', 404, 'not_found');
  const row = await db.designSession.findUnique({ where: { id: publish.session_id } });
  if (!row) throw new ApiError('Publish not found', 404, 'not_found');
  const session = await withStanding(actor, row, db);
  // W8.2 H2: a designer who is no longer on the project (or no longer owns the session) is a stranger here,
  // before any token check can tell her anything about the intent.
  if (actor.role === 'designer' && (session.designer_id !== actor.userId || !session.designer_on_project)) {
    throw new ApiError('Publish not found', 404, 'not_found');
  }
  const ctx = await loadContext(db, publish.site_id);
  const now = opts.now ?? new Date();

  const check = checkConfirmation({
    actor,
    publish,
    token: input.confirmation_token,
    typed: input.typed_confirmation,
    current: { head_sha: session.head_sha, gate_status: gateStatus(session.publish_precheck, session.head_sha), main_role: ctx.mainRole },
    now,
  });
  if (!check.ok) {
    if (check.code === 'confirmation_expired' && publish.status === 'awaiting_confirmation') {
      await db.designPublish.updateMany({ where: { id: publish.id, status: 'awaiting_confirmation' }, data: { status: 'expired', confirmation_token_hash: null } });
    }
    fail(check);
  }

  // Where `main` deploys must still be what the dialog said (T24): the live URL and the branch name too.
  const shown = shownOf(publish.confirmation_shown);
  const nowShown = confirmationShown({ site: ctx.site, mainRole: ctx.mainRole, liveUrl: ctx.liveUrl, session: { ...session, publish_precheck: null } });
  if ((shown.live_url ?? null) !== nowShown.live_url || shown.main_branch !== nowShown.main_branch) {
    fail(refuse('main_role_changed', 'Where this site publishes changed since the review; review again'));
  }

  const decision = canPublish(actor, session, ctx.site, policySettings(ctx), ctx.mainRole, { head_sha: publish.head_sha });
  if (!decision.ok && ACTOR_CODES.has(decision.code)) fail(decision);
  requireEnabled(ctx);
  if (!decision.ok) fail(decision);

  const tokenHash = hashConfirmationToken((input.confirmation_token ?? '').trim());
  const typed = (input.typed_confirmation ?? '').trim();
  try {
    await db.$transaction(async (tx) => {
      if (await sitePublishRunning(tx, publish.site_id, publish.id)) {
        throw new ApiError('Another publish is queued or running for this site', 409, 'publish_in_progress');
      }
      const consumed = await tx.designPublish.updateMany({
        where: { id: publish.id, status: 'awaiting_confirmation', confirmation_token_hash: tokenHash, confirmation_expires_at: { gt: now } },
        data: { status: 'queued', confirmed_at: now, confirmation_typed: typed, confirmation_token_hash: null },
      });
      if (consumed.count !== 1) throw new ApiError('This confirmation was already used or superseded', 409, 'confirmation_used');

      await createCommand(
        {
          sessionId: session.id,
          verb: 'publish',
          createdById: actor.userId,
          payload: {
            publish_id: publish.id,
            head_sha: publish.head_sha,
            main_role: normalizeMainRole(publish.main_role),
            live_url: nowShown.live_url,
            main_branch: nowShown.main_branch,
            actor_role: publish.actor_role,
            publish_mode: publish.publish_mode,
            site_designer_publish: publish.site_designer_publish,
          },
        },
        tx,
      );

      // The session follows (8.7: awaiting_input -> publishing is a server move). paused_budget has no
      // publishing move in the table; it already holds designer notes, so it stays as it is.
      const s = await tx.designSession.findUnique({ where: { id: session.id }, select: { status: true, head_sha: true } });
      if (!s || s.head_sha !== publish.head_sha) throw new ApiError('The design branch moved since the review; review again', 409, 'stale_head');
      if (s.status === 'awaiting_input') {
        transition(s, 'publishing', 'server');
        const moved = await tx.designSession.updateMany({
          where: { id: session.id, status: 'awaiting_input', head_sha: publish.head_sha },
          data: { status: 'publishing' },
        });
        if (moved.count !== 1) throw new ApiError('Session changed state; review again', 409, 'state_conflict');
      } else if (s.status !== 'paused_budget') {
        throw new ApiError('The session is not ready to publish', 409, 'state_conflict');
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError('Another publish is queued or running for this site', 409, 'publish_in_progress');
    throw e;
  }
  return { publish_id: publish.id };
}

// ---------------------------------------------------------------------------------------------------------
// Request publish (POST /api/design/sessions/:id/request-publish)
// ---------------------------------------------------------------------------------------------------------

/**
 * Only where an admin override has switched designer publish off for this site (else 409 publish_allowed).
 * Stamps publish_requested_at/by and sends the owner (admins when no owner is set) an FYI
 * `design_publish_requested`. Nothing waits on it.
 */
export async function requestPublish(
  actor: DesignActor,
  sessionId: string,
  note: string | null | undefined,
  opts: { now?: Date } = {},
  db: Db = defaultDb,
) {
  const session = await withStanding(actor, await loadSessionFor(actor, sessionId, { mode: 'read' }, db), db);
  const ctx = await loadContext(db, session.site_id);
  const decision = canRequestPublish(actor, session, ctx.site, policySettings(ctx), ctx.mainRole);
  if (!decision.ok && ACTOR_CODES.has(decision.code)) fail(decision);
  requireEnabled(ctx);
  if (!decision.ok) fail(decision);

  const now = opts.now ?? new Date();
  const moved = await db.designSession.updateMany({
    where: { id: session.id, status: { notIn: ['closed', 'abandoned', 'publishing'] } },
    data: { publish_requested_at: now, publish_requested_by: actor.userId },
  });
  if (moved.count !== 1) throw new ApiError('Session changed state; reload and retry', 409, 'state_conflict');
  const updated = await db.designSession.findUniqueOrThrow({ where: { id: session.id } });

  const [task, who] = await Promise.all([
    db.task.findUnique({ where: { id: session.task_id }, select: { title: true } }),
    db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
  ]);
  const recipients = await fyiRecipients(db, { exclude: actor.userId });
  const text = (note ?? '').trim();
  await notifyAll(recipients, {
    type: 'design_publish_requested',
    priority: 'normal',
    title: clip(`Publish requested: ${task?.title ?? 'design session'}`, 255),
    message: `${who?.name ?? 'A designer'} asked for a publish of ${ctx.site.name} (designer publish is switched off there).${text ? ` Note: ${text}` : ''}`,
    entityType: 'design_session',
    entityId: session.id,
    bundleKey: `design-publish-request:${session.id}`,
  });
  return { session: projectSession(updated, now) };
}

// ---------------------------------------------------------------------------------------------------------
// Rollback (POST /api/design/publishes/:id/rollback)
// ---------------------------------------------------------------------------------------------------------

/**
 * One click (D5: the click is the confirmation, so confirmed_at = now): admin, or that publish's actor while
 * she is a designer on the project with designer publish on for the site (canRollback; pm 403, anyone else
 * 404), the site's latest successful publish only (409 not_latest), nothing else queued or running on the site. Creates DesignPublish(kind rollback, queued) + DesignCommand(rollback) in
 * one transaction; the session moves to `publishing` when it is idle (`awaiting_input`).
 */
export async function createRollback(
  actor: DesignActor,
  targetId: string,
  reason: string | null | undefined,
  opts: { now?: Date } = {},
  db: Db = defaultDb,
): Promise<{ publish_id: string }> {
  if (!isUuid(targetId)) throw new ApiError('Publish not found', 404, 'not_found');
  const target = await db.designPublish.findUnique({ where: { id: targetId } });
  if (!target) throw new ApiError('Publish not found', 404, 'not_found');
  const [latest, session, ctx] = await Promise.all([
    db.designPublish.findFirst(latestPublishedQuery(target.site_id)),
    db.designSession.findUnique({ where: { id: target.session_id }, select: { designer_id: true, project_id: true } }),
    loadContext(db, target.site_id),
  ]);
  const check = canRollback(actor, target, latest, {
    publishRunning: await sitePublishRunning(db, target.site_id),
    designer: await rollbackStanding(actor, session, ctx, db),
  });
  if (!check.ok && ACTOR_CODES.has(check.code)) fail(check);
  requireEnabled(ctx);
  if (!check.ok) fail(check);

  const now = opts.now ?? new Date();
  const why = (reason ?? '').trim() || null;
  const shown = confirmationShown({
    site: ctx.site,
    mainRole: ctx.mainRole,
    liveUrl: ctx.liveUrl,
    session: { head_sha: null, cost_usd: 0, diff_summary: null, publish_precheck: null },
  });
  try {
    const row = await db.$transaction(async (tx) => {
      if (await sitePublishRunning(tx, target.site_id)) throw new ApiError('Another publish is queued or running for this site', 409, 'publish_in_progress');
      const created = await tx.designPublish.create({
        data: {
          session_id: target.session_id,
          site_id: target.site_id,
          task_id: target.task_id,
          kind: 'rollback',
          rolls_back_id: target.id,
          actor_id: actor.userId,
          actor_role: actor.role === 'admin' ? 'admin' : 'designer',
          actor_via: actorViaOf(actor),
          actor_api_key_id: actorViaOf(actor) === 'operator_key' ? (actor.apiKeyId ?? null) : null,
          publish_mode: normalizePublishMode(ctx.settings?.designer_publish_mode),
          main_role: ctx.mainRole,
          site_designer_publish: ctx.site.designer_publish,
          confirmation_shown: { ...shown, rollback_reason: why, rolls_back: { id: target.id, result_sha: target.result_sha, from_main_sha: target.from_main_sha } } as unknown as Prisma.InputJsonValue,
          confirm_requested_at: now,
          confirmed_at: now,
          status: 'queued',
          from_main_sha: target.result_sha,
        },
        select: { id: true },
      });
      await createCommand(
        {
          sessionId: target.session_id,
          verb: 'rollback',
          createdById: actor.userId,
          payload: {
            publish_id: created.id,
            target_publish_id: target.id,
            target_result_sha: target.result_sha,
            target_from_main_sha: target.from_main_sha,
            main_role: ctx.mainRole,
            live_url: shown.live_url,
            main_branch: shown.main_branch,
            reason: why,
          },
        },
        tx,
      );
      await tx.designSession.updateMany({ where: { id: target.session_id, status: 'awaiting_input' }, data: { status: 'publishing' } });
      return created;
    });
    return { publish_id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError('Another publish is queued or running for this site', 409, 'publish_in_progress');
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The publish page (GET /api/design/publishes/:id)
// ---------------------------------------------------------------------------------------------------------

/** admin, pm, or the session's designer; anyone else (and a malformed id) 404. */
export async function loadPublishPage(actor: DesignActor, publishId: string, db: Db = defaultDb) {
  if (!isUuid(publishId)) throw new ApiError('Publish not found', 404, 'not_found');
  const publish = await db.designPublish.findUnique({ where: { id: publishId } });
  if (!publish) throw new ApiError('Publish not found', 404, 'not_found');
  const session = await db.designSession.findUnique({ where: { id: publish.session_id }, select: { id: true, designer_id: true, task_id: true, project_id: true } });
  if (!session || publishPageAccess(actor, session) !== 'ok') throw new ApiError('Publish not found', 404, 'not_found');
  // W8.2 H2: a designer reads the page only while she still has the session (on its project now).
  if (actor.role === 'designer' && (await currentSessionAccess(actor, session, 'read', db)) !== 'ok') {
    throw new ApiError('Publish not found', 404, 'not_found');
  }

  const [task, designer, changes, latest, running, ctx] = await Promise.all([
    db.task.findUnique({ where: { id: session.task_id }, select: { id: true, title: true } }),
    db.user.findUnique({ where: { id: session.designer_id }, select: { name: true } }),
    db.designChange.findMany({
      where: publish.change_ids.length > 0
        ? { session_id: session.id, id: { in: publish.change_ids } }
        : { session_id: session.id, created_at: { lte: publish.created_at } },
      orderBy: { created_at: 'asc' },
      select: { id: true, summary: true, data_libs: true, pages: true, before_asset_ids: true, after_asset_ids: true, decision: true, edit_scope: true, render_count: true },
    }),
    db.designPublish.findFirst(latestPublishedQuery(publish.site_id)),
    sitePublishRunning(db, publish.site_id),
    loadContext(db, publish.site_id),
  ]);
  const rollback = canRollback(actor, publish, latest, { publishRunning: running, designer: await rollbackStanding(actor, session, ctx, db) });
  return projectPublishPage({
    publish,
    session: { id: session.id, task: { id: session.task_id, title: task?.title ?? '' }, designer: { name: designer?.name ?? '' } },
    changes,
    rollback: rollback.ok ? { ok: true } : { ok: false, code: rollback.code },
  });
}

// ---------------------------------------------------------------------------------------------------------
// The worker's PATCH (W2.5's route calls applyWorkerPublishPatch; keep the signature stable)
// ---------------------------------------------------------------------------------------------------------

export interface PublishResult {
  from_main_sha?: string | null;
  result_sha?: string | null;
  deploy_id?: string | null;
  deploy_url?: string | null;
  alias_url?: string | null;
  gates?: unknown;
  diff_summary?: unknown;
  change_ids?: string[];
}

export interface WorkerPublishPatch extends PublishResult {
  status: WorkerPublishStatus;
  error?: string | null;
}

export interface PublishCompletionOptions {
  /** The design-worker service user (the route passes auth.userId); looked up by email when absent. */
  workerUserId?: string;
  now?: Date;
  db?: Db;
}

const MAX_ERROR_CHARS = 8000;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function resultData(r: PublishResult) {
  return {
    ...(r.from_main_sha !== undefined ? { from_main_sha: r.from_main_sha } : {}),
    ...(r.result_sha !== undefined ? { result_sha: r.result_sha } : {}),
    ...(r.deploy_id !== undefined ? { deploy_id: r.deploy_id } : {}),
    ...(r.deploy_url !== undefined ? { deploy_url: r.deploy_url } : {}),
    ...(r.alias_url !== undefined ? { alias_url: r.alias_url } : {}),
    ...(r.gates !== undefined ? { gates: (r.gates ?? Prisma.DbNull) as Prisma.InputJsonValue } : {}),
    ...(r.diff_summary !== undefined ? { diff_summary: (r.diff_summary ?? Prisma.DbNull) as Prisma.InputJsonValue } : {}),
    ...(r.change_ids !== undefined ? { change_ids: r.change_ids.filter(isUuid) } : {}),
  };
}

/**
 * PATCH worker/publishes/:id. `running` from `queued`; `published` (from `running`) runs completePublish;
 * `failed`, `blocked_gates`, `conflict` (from `queued` or `running`) run failPublish. A repeat of the
 * status the row already has returns the row unchanged (a retried PATCH after a lost response). The worker
 * can never move a row out of `awaiting_confirmation`, nor touch actor, mode, main_role or confirmation fields.
 */
export async function applyWorkerPublishPatch(publishId: string, patch: WorkerPublishPatch, opts: PublishCompletionOptions = {}): Promise<DesignPublish> {
  if (!(WORKER_PUBLISH_STATUSES as readonly string[]).includes(patch.status)) {
    throw new ApiError('status must be running, published, blocked_gates, conflict or failed', 400, 'bad_status');
  }
  const { status, error, ...result } = patch;
  if (status === 'published') return completePublish(publishId, result, opts);
  if (status === 'running') return markPublishRunning(publishId, result, opts);
  return failPublish(publishId, status, { ...result, error: error ?? null }, opts);
}

async function loadForWorker(db: Db | Tx, publishId: string): Promise<DesignPublish> {
  if (!isUuid(publishId)) throw new ApiError('Publish not found', 404, 'not_found');
  const row = await db.designPublish.findUnique({ where: { id: publishId } });
  if (!row) throw new ApiError('Publish not found', 404, 'not_found');
  return row;
}

export async function markPublishRunning(publishId: string, result: PublishResult = {}, opts: PublishCompletionOptions = {}): Promise<DesignPublish> {
  const db = opts.db ?? defaultDb;
  const row = await loadForWorker(db, publishId);
  if (row.status === 'running') return row;
  assertPublishMove(row.status, 'running', 'worker');
  const res = await db.designPublish.updateMany({
    where: { id: row.id, status: 'queued', confirmed_at: { not: null } },
    data: { status: 'running', started_at: opts.now ?? new Date(), ...(result.from_main_sha !== undefined ? { from_main_sha: result.from_main_sha } : {}) },
  });
  if (res.count !== 1) throw new ApiError('The publish changed state; reload', 409, 'illegal_transition');
  return db.designPublish.findUniqueOrThrow({ where: { id: row.id } });
}

/** Allocate one seq under the session row lock and write a system `publish` event (inside the caller's transaction). */
async function appendPublishEvent(tx: Tx, sessionId: string, payload: Prisma.InputJsonValue): Promise<void> {
  const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE design_sessions SET last_seq = last_seq + 1 WHERE id = ${sessionId}::uuid RETURNING last_seq`;
  if (rows.length !== 1) return;
  await tx.designEvent.create({ data: { session_id: sessionId, seq: rows[0].last_seq, role: 'system', kind: 'publish', payload } });
}

/** The session after a publish ends: `publishing` -> `awaiting_input` (a server move); other states are left alone. */
async function releaseSession(tx: Tx, sessionId: string, data: Prisma.DesignSessionUpdateManyMutationInput): Promise<void> {
  const s = await tx.designSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!s) return;
  const back = s.status === 'publishing';
  if (back) transition(s, 'awaiting_input', 'server');
  await tx.designSession.updateMany({
    where: { id: sessionId, status: s.status },
    data: { ...data, ...(back ? { status: 'awaiting_input' as const } : {}) },
  });
}

const FAIL_TEXT: Record<'failed' | 'blocked_gates' | 'conflict', string> = {
  failed: 'The publish failed',
  blocked_gates: 'A gate was red on the merged tree; nothing was published',
  conflict: 'Main changed under this branch and could not be merged; the worker will resolve it on your next turn',
};

/**
 * failed | blocked_gates | conflict: the row is final with the error, the session goes back to
 * `awaiting_input`, and the reason is posted to the session as a system `publish` event. When main moved
 * before the failure (a deploy failure after the fast-forward: result_sha present), base_sha follows main
 * and the owner gets the same FYI as for a publish (design 4.3).
 */
export async function failPublish(
  publishId: string,
  status: 'failed' | 'blocked_gates' | 'conflict',
  info: PublishResult & { error?: string | null },
  opts: PublishCompletionOptions = {},
): Promise<DesignPublish> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const error = info.error ? clip(info.error, MAX_ERROR_CHARS) : null;
  const { row, replay } = await db.$transaction(async (tx) => {
    const current = await loadForWorker(tx, publishId);
    if (current.status === status) return { row: current, replay: true };
    assertPublishMove(current.status, status, 'worker');
    const res = await tx.designPublish.updateMany({
      where: { id: current.id, status: current.status },
      data: { ...resultData(info), status, error, finished_at: now },
    });
    if (res.count !== 1) throw new ApiError('The publish changed state; reload', 409, 'illegal_transition');
    const mainMoved = !!info.result_sha && current.kind === 'publish';
    await releaseSession(tx, current.session_id, mainMoved ? { base_sha: info.result_sha } : {});
    await appendPublishEvent(tx, current.session_id, {
      publish_id: current.id,
      kind: current.kind,
      status,
      summary: error ? `${FAIL_TEXT[status]}: ${clip(error, 2000)}` : FAIL_TEXT[status],
      ...(error ? { error: clip(error, 8000) } : {}),
    });
    return { row: await tx.designPublish.findUniqueOrThrow({ where: { id: current.id } }), replay: false };
  });
  if (!replay && status === 'failed' && row.result_sha && row.kind === 'publish') {
    await sendPublishNotices(db, row, { failedAfterMainMoved: true });
  }
  return row;
}

/** The approval_source for the live receipt: a uuid-only prefix cleanApprovalSource() keeps. */
export function approvalSourceFor(p: Pick<DesignPublish, 'id' | 'kind' | 'actor_role'> & { actor_via?: string | null }): string {
  if (p.actor_via === 'operator_key') return p.kind === 'rollback' ? `design_operator_rollback:${p.id}` : `design_operator_publish:${p.id}`;
  if (p.kind === 'rollback') return `design_rollback:${p.id}`;
  return p.actor_role === 'admin' ? `design_admin_publish:${p.id}` : `design_publish:${p.id}`;
}

function gateList(raw: unknown): Array<{ name: string; ok: boolean; summary?: string; reported?: boolean }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object' && typeof (g as Record<string, unknown>).name === 'string')
    .map((g) => ({
      name: String(g.name),
      ok: g.ok === true,
      ...(typeof g.summary === 'string' ? { summary: g.summary } : {}),
      ...(g.reported === true ? { reported: true } : {}),
    }));
}

function gateChecks(raw: unknown): CheckEntry[] {
  return gateList(raw).slice(0, 60).map((g) => ({ name: clip(g.name, 100), ok: g.ok, ...(g.summary ? { detail: clip(g.summary, 500) } : {}) }));
}

function short(sha: string | null | undefined, n = 12): string {
  return sha ? sha.slice(0, n) : 'unknown';
}

/** The internal task comment: who, what they confirmed, the commit, the deploy, the gates and the cost. Pure. */
export function publishCommentText(input: {
  publish: Pick<DesignPublish, 'id' | 'kind' | 'actor_role' | 'main_role' | 'head_sha' | 'from_main_sha' | 'result_sha' | 'deploy_url' | 'alias_url' | 'gates' | 'confirmation_shown' | 'confirmation_typed' | 'confirmed_at' | 'cost_usd' | 'rolls_back_id'> & { actor_via?: string | null };
  actorName: string;
  siteName: string;
}): string {
  const p = input.publish;
  const shown = shownOf(p.confirmation_shown);
  const target = typeof shown.target_words === 'string' ? shown.target_words : normalizeMainRole(p.main_role) === 'production' ? `the live production site for ${input.siteName}` : `the client preview for ${input.siteName}`;
  const gates = gateList(p.gates);
  const gateLine = gates.length > 0 ? gates.map((g) => `${g.name} ${g.ok ? 'ok' : g.reported ? 'red (reported)' : 'red'}`).join(', ') : 'none reported';
  const lines: string[] = [];
  const byOperator = p.actor_via === 'operator_key';
  if (byOperator) {
    // Mike's ruling (2026-10-29): say plainly that Bast pressed the button with Mike's operator key.
    const verb = p.kind === 'rollback' ? 'rolled back' : 'published';
    lines.push(`Design ${p.kind === 'rollback' ? 'rollback' : 'publish'} ${p.id.slice(0, 8)} to ${target}: ${verb} by ${operatorPhrase(input.actorName)} (operator key; actor ${input.actorName}, ${p.actor_role}).`);
  }
  if (p.kind === 'rollback') {
    if (!byOperator) lines.push(`Design rollback ${p.id.slice(0, 8)} published to ${target} by ${input.actorName} (${p.actor_role}), one click.`);
    lines.push(`Rolled back publish ${p.rolls_back_id ? p.rolls_back_id.slice(0, 8) : 'unknown'}; main ${short(p.from_main_sha)} -> ${short(p.result_sha)} (the tree from before that publish).`);
    if (typeof shown.rollback_reason === 'string' && shown.rollback_reason) lines.push(`Reason: ${clip(shown.rollback_reason, 500)}`);
  } else {
    if (!byOperator) lines.push(`Design publish ${p.id.slice(0, 8)} to ${target} by ${input.actorName} (${p.actor_role}).`);
    lines.push(`Confirmed: typed "${p.confirmation_typed ?? ''}"${p.confirmed_at ? ` at ${p.confirmed_at.toISOString()}` : ''} for design head ${short(p.head_sha)}.`);
    lines.push(`Commit: main ${short(p.from_main_sha)} -> ${short(p.result_sha)}.`);
  }
  lines.push(`Deploy: ${p.deploy_url ?? 'unknown'}${p.alias_url ? ` (${p.alias_url})` : ''}.`);
  lines.push(`Gates: ${gateLine}.`);
  if (p.kind !== 'rollback') lines.push(`Session cost: $${toUsd(p.cost_usd).toFixed(2)}.`);
  return lines.join('\n');
}

async function workerUserId(db: Db | Tx, explicit: string | undefined, fallback: string): Promise<string> {
  if (explicit && isUuid(explicit)) return explicit;
  const u = await db.user.findFirst({ where: { email: { equals: DESIGN_WORKER_SERVICE_EMAIL, mode: 'insensitive' } }, select: { id: true } });
  return u?.id ?? fallback;
}

/**
 * The `published` transaction (7.3). Idempotent on a repeat (the row is already published or later rolled
 * back: returned unchanged, nothing written twice). Notifications go out after the commit.
 */
export async function completePublish(publishId: string, result: PublishResult, opts: PublishCompletionOptions = {}): Promise<DesignPublish> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const { row, replay } = await db.$transaction(async (tx) => {
    const current = await loadForWorker(tx, publishId);
    if (current.status === 'published' || current.status === 'rolled_back') return { row: current, replay: true };
    assertPublishMove(current.status, 'published', 'worker');
    const res = await tx.designPublish.updateMany({
      where: { id: current.id, status: current.status },
      data: { ...resultData(result), status: 'published', error: null, finished_at: now },
    });
    if (res.count !== 1) throw new ApiError('The publish changed state; reload', 409, 'illegal_transition');
    const p = await tx.designPublish.findUniqueOrThrow({ where: { id: current.id } });

    if (p.kind === 'rollback' && p.rolls_back_id) {
      const target = await tx.designPublish.findUnique({ where: { id: p.rolls_back_id }, select: { status: true } });
      if (target) assertPublishMove(target.status, 'rolled_back', 'server');
      await tx.designPublish.updateMany({
        where: { id: p.rolls_back_id, status: 'published' },
        data: { status: 'rolled_back', rolled_back_at: now, rolled_back_by_id: p.actor_id },
      });
    }

    await releaseSession(tx, p.session_id, {
      last_publish_id: p.id,
      ...(p.kind === 'publish' && p.result_sha ? { base_sha: p.result_sha } : {}),
    });

    const [actor, site] = await Promise.all([
      tx.user.findUnique({ where: { id: p.actor_id }, select: { name: true } }),
      tx.site.findUnique({ where: { id: p.site_id }, select: { name: true } }),
    ]);
    await tx.comment.create({
      data: {
        task_id: p.task_id,
        user_id: await workerUserId(tx, opts.workerUserId, p.actor_id),
        is_internal: true,
        actor_lane: DESIGN_WORKER_LANE,
        content: publishCommentText({ publish: p, actorName: actor?.name ?? 'unknown', siteName: site?.name ?? 'the site' }),
      },
    });

    if (normalizeMainRole(p.main_role) === 'production') {
      const shown = shownOf(p.confirmation_shown);
      await writeReceipt(
        {
          task_id: p.task_id,
          step: 'live',
          commit_sha: p.result_sha,
          deploy_id: p.deploy_id,
          deploy_url: p.deploy_url,
          live_url: p.alias_url ?? (typeof shown.live_url === 'string' ? shown.live_url : null),
          checks: gateChecks(p.gates),
          approval_source: cleanApprovalSource(approvalSourceFor(p)),
          actor_user_id: p.actor_id,
        },
        tx,
      );
    }
    return { row: p, replay: false };
  });
  if (!replay) await sendPublishNotices(db, row, {});
  return replay ? row : (await db.designPublish.findUnique({ where: { id: row.id } })) ?? row;
}

// ---------------------------------------------------------------------------------------------------------
// FYI notifications (never an approval)
// ---------------------------------------------------------------------------------------------------------

/**
 * The owner (DesignPortalSettings.owner_user_id, Mike) when set and active, else every active admin; plus
 * `extra` (the original publisher on a rollback); never the person who clicked.
 */
export async function fyiRecipients(db: Db | Tx, opts: { extra?: Array<string | null | undefined>; exclude?: string | null } = {}): Promise<string[]> {
  const settings = await db.designPortalSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  let base: string[] = [];
  if (settings?.owner_user_id) {
    const owner = await db.user.findUnique({ where: { id: settings.owner_user_id }, select: { id: true, is_active: true } });
    if (owner?.is_active) base = [owner.id];
  }
  if (base.length === 0) {
    base = (await db.user.findMany({ where: { role: 'admin', is_active: true }, select: { id: true }, orderBy: { created_at: 'asc' } })).map((u) => u.id);
  }
  const extra = (opts.extra ?? []).filter((id): id is string => !!id && isUuid(id));
  const activeExtra = extra.length
    ? (await db.user.findMany({ where: { id: { in: extra }, is_active: true }, select: { id: true } })).map((u) => u.id)
    : [];
  return [...new Set([...base, ...activeExtra])].filter((id) => id !== opts.exclude);
}

interface Notice {
  type: 'design_published' | 'design_publish_requested' | 'design_rolled_back';
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: 'design_publish' | 'design_session';
  entityId: string;
  bundleKey?: string;
}

/** Dispatch to each recipient; a failed channel is logged, never thrown (the publish already happened). */
async function notifyAll(userIds: string[], n: Notice): Promise<boolean> {
  let ok = true;
  for (const userId of userIds) {
    try {
      await dispatchNotification({ userId, ...n });
    } catch (e) {
      ok = false;
      console.error('design notification failed', { type: n.type, entityId: n.entityId, error: (e as Error).message });
    }
  }
  return ok;
}

export function publishPriority(mainRole: unknown): NotificationPriority {
  return normalizeMainRole(mainRole) === 'production' ? 'high' : 'normal';
}

async function sendPublishNotices(db: Db, p: DesignPublish, ctx: { failedAfterMainMoved?: boolean }): Promise<void> {
  try {
    const [actor, task] = await Promise.all([
      db.user.findUnique({ where: { id: p.actor_id }, select: { name: true } }),
      db.task.findUnique({ where: { id: p.task_id }, select: { title: true } }),
    ]);
    const shown = shownOf(p.confirmation_shown);
    const host = displayHost(p.alias_url ?? (typeof shown.live_url === 'string' ? shown.live_url : null));
    const production = normalizeMainRole(p.main_role) === 'production';
    const where = production ? `the LIVE site${host ? ` ${host}` : ''}` : `the client preview${host ? ` ${host}` : ''}`;
    const taskTitle = task?.title ?? 'design session';
    const byOperator = p.actor_via === 'operator_key';
    const who = byOperator ? `${operatorPhrase(actor?.name)} (operator key, ${p.actor_role})` : `${actor?.name ?? 'Someone'} (${p.actor_role})`;
    // The person who clicked is never notified of their own click; an operator-key publish was Bast's click, so its
    // key owner (Mike) still gets the FYI.
    const exclude = byOperator ? null : p.actor_id;
    const gates = gateList(p.gates);
    const gateText = gates.length ? `Gates: ${gates.filter((g) => g.ok).length}/${gates.length} green.` : '';

    let recipients: string[];
    let notice: Notice;
    if (p.kind === 'rollback') {
      const target = p.rolls_back_id ? await db.designPublish.findUnique({ where: { id: p.rolls_back_id }, select: { actor_id: true } }) : null;
      recipients = await fyiRecipients(db, { extra: [target?.actor_id], exclude });
      notice = {
        type: 'design_rolled_back',
        priority: publishPriority(p.main_role),
        title: clip(`Rolled back on ${where}: ${taskTitle}`, 255),
        message: `${who} rolled back the last publish. Main is now ${short(p.result_sha)}. Deploy: ${p.deploy_url ?? 'unknown'}. ${gateText}`.trim(),
        entityType: 'design_publish',
        entityId: p.id,
      };
    } else if (ctx.failedAfterMainMoved) {
      recipients = await fyiRecipients(db, { exclude });
      notice = {
        type: 'design_published',
        priority: publishPriority(p.main_role),
        title: clip(`Publish failed after main moved (${where}): ${taskTitle}`, 255),
        message: `${who} published; main is at ${short(p.result_sha)} but the deploy failed, so it is NOT live yet. Publishing again redeploys it. ${p.error ? clip(p.error, 500) : ''}`.trim(),
        entityType: 'design_publish',
        entityId: p.id,
      };
    } else {
      recipients = await fyiRecipients(db, { exclude });
      notice = {
        type: 'design_published',
        priority: publishPriority(p.main_role),
        title: clip(`Published to ${where}: ${taskTitle}`, 255),
        message: `${who} published. Commit ${short(p.result_sha)}. Deploy: ${p.deploy_url ?? 'unknown'}. ${gateText} Session cost $${toUsd(p.cost_usd).toFixed(2)}.`.trim(),
        entityType: 'design_publish',
        entityId: p.id,
      };
    }
    const ok = await notifyAll(recipients, notice);
    if (ok) await db.designPublish.update({ where: { id: p.id }, data: { notified_at: new Date() } });
  } catch (e) {
    console.error('design publish notices failed', { publishId: p.id, error: (e as Error).message });
  }
}

export type { DesignSession };
