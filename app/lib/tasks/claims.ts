/**
 * Fleet item 3: task claims with leases. Exactly one live owner per task.
 *
 * A claim is ONE UPDATE with the whole rule in its WHERE clause (compare and set), the same shape as the
 * engine queue and the outbox claim. It never reads first and writes second: two claimers racing on one
 * row serialize on the row lock, and the second one re-checks the WHERE against the winner's committed row.
 * All times come from the database clock, in UTC, so a drifting worker clock cannot steal or extend a lease.
 *
 * Fields on tasks: claim_holder (who), claim_token (the proof of ownership, a uuid), claimed_at, lease_until.
 * A lease is live while lease_until is in the future. No lease, or an expired one, means nobody owns the task.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { logActivity } from '@/lib/services/activity';

export const TTL_MIN_SECONDS = 60;
export const TTL_MAX_SECONDS = 21600;
export const TTL_DEFAULT_SECONDS = 1800;
export const CLAIM_MODES = ['off', 'warn', 'enforce'] as const;
export type ClaimMode = (typeof CLAIM_MODES)[number];

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | 'task' | 'appSettings' | 'user'>;

/** Spread into a task update to clear the claim in the same write (a person moved the task). */
export const CLEAR_CLAIM_DATA = { claim_holder: null, claim_token: null, claimed_at: null, lease_until: null } as const;

// The columns are `timestamp without time zone` holding UTC (Prisma writes UTC), so compare against UTC now.
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export function clampTtl(ttl: number | null | undefined): number {
  const n = Number.isFinite(ttl as number) ? Math.trunc(ttl as number) : TTL_DEFAULT_SECONDS;
  return Math.min(TTL_MAX_SECONDS, Math.max(TTL_MIN_SECONDS, n));
}

export interface Claim {
  task_id: string;
  holder: string;
  token: string;
  claimed_at: Date;
  lease_until: Date;
}

export type ClaimResult =
  | { ok: true; claim: Claim }
  | { ok: false; reason: 'not_found' | 'closed' | 'taken'; holder?: string | null; lease_until?: Date | null };

interface ClaimRow {
  id: string;
  claim_holder: string;
  claim_token: string;
  claimed_at: Date;
  lease_until: Date;
}

const toClaim = (r: ClaimRow): Claim => ({ task_id: r.id, holder: r.claim_holder, token: r.claim_token, claimed_at: r.claimed_at, lease_until: r.lease_until });

export function isLeaseLive(task: { lease_until: Date | null }, now: Date = new Date()): boolean {
  return task.lease_until !== null && task.lease_until > now;
}

/**
 * Claim a task. Wins when the task is open and (nobody holds it, the lease ran out, or the caller already
 * holds it). The same holder with a live lease keeps its token (a retry is not a new claim); anyone else
 * gets a fresh token. A claim never changes the task's status: the holder moves it through the normal route.
 */
export async function claimTask(
  input: { taskId: string; holder: string; ttlSeconds?: number | null },
  db: Db = defaultDb,
): Promise<ClaimResult> {
  const ttl = clampTtl(input.ttlSeconds);
  const rows = await db.$queryRaw<ClaimRow[]>`
    UPDATE tasks SET
      claim_token = CASE WHEN claim_holder = ${input.holder} AND lease_until > ${NOW} THEN claim_token ELSE gen_random_uuid() END,
      claimed_at  = CASE WHEN claim_holder = ${input.holder} AND lease_until > ${NOW} THEN claimed_at ELSE ${NOW} END,
      claim_holder = ${input.holder},
      lease_until = ${NOW} + make_interval(secs => ${ttl}::int)
    WHERE id = ${input.taskId}::uuid
      AND is_deleted = false
      AND status NOT IN ('done', 'abandoned')
      AND (lease_until IS NULL OR lease_until < ${NOW} OR claim_holder = ${input.holder})
    RETURNING id, claim_holder, claim_token::text AS claim_token, claimed_at, lease_until`;
  if (rows.length === 1) return { ok: true, claim: toClaim(rows[0]) };
  // Lost. This read only explains the loss; the decision was already made by the UPDATE.
  const t = await db.task.findUnique({ where: { id: input.taskId }, select: { is_deleted: true, status: true, claim_holder: true, lease_until: true } });
  if (!t || t.is_deleted) return { ok: false, reason: 'not_found' };
  if (t.status === 'done' || t.status === 'abandoned') return { ok: false, reason: 'closed', holder: t.claim_holder, lease_until: t.lease_until };
  return { ok: false, reason: 'taken', holder: t.claim_holder, lease_until: t.lease_until };
}

/** Extend a live lease. Needs the claim token and a lease that has not lapsed. */
export async function renewClaim(input: { taskId: string; token: string; ttlSeconds?: number | null }, db: Db = defaultDb): Promise<Claim | null> {
  if (!isUuid(input.token)) return null;
  const ttl = clampTtl(input.ttlSeconds);
  const rows = await db.$queryRaw<ClaimRow[]>`
    UPDATE tasks SET lease_until = ${NOW} + make_interval(secs => ${ttl}::int)
    WHERE id = ${input.taskId}::uuid AND is_deleted = false AND claim_token = ${input.token}::uuid AND lease_until > ${NOW}
    RETURNING id, claim_holder, claim_token::text AS claim_token, claimed_at, lease_until`;
  return rows.length === 1 ? toClaim(rows[0]) : null;
}

/** Extend every live lease one holder owns (the worker's background renewer). Returns the count. */
export async function renewHolder(input: { holder: string; ttlSeconds?: number | null }, db: Db = defaultDb): Promise<number> {
  const ttl = clampTtl(input.ttlSeconds);
  return db.$executeRaw`
    UPDATE tasks SET lease_until = ${NOW} + make_interval(secs => ${ttl}::int)
    WHERE claim_holder = ${input.holder} AND is_deleted = false AND lease_until > ${NOW}`;
}

/**
 * Give a claim up. A wrong token changes nothing (returns false). It clears the claim and nothing else: the
 * task's status is never touched here (the holder moves it through the normal route, with the token).
 */
export async function releaseClaim(input: { taskId: string; token: string }, db: Db = defaultDb): Promise<boolean> {
  if (!isUuid(input.token)) return false;
  const n = await db.$executeRaw`
    UPDATE tasks SET claim_holder = NULL, claim_token = NULL, claimed_at = NULL, lease_until = NULL
    WHERE id = ${input.taskId}::uuid AND claim_token = ${input.token}::uuid`;
  return n === 1;
}

/** Release every claim one holder owns, live or lapsed (the worker's cleanup trap). Returns the count. */
export async function releaseHolder(input: { holder: string }, db: Db = defaultDb): Promise<number> {
  return db.$executeRaw`
    UPDATE tasks SET claim_holder = NULL, claim_token = NULL, claimed_at = NULL, lease_until = NULL
    WHERE claim_holder = ${input.holder}`;
}

export async function getClaim(taskId: string, db: Db = defaultDb) {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { id: true, is_deleted: true, status: true, claim_holder: true, claimed_at: true, lease_until: true } });
  if (!t || t.is_deleted) return null;
  const live = isLeaseLive(t);
  // The token is never returned here: it is the proof of ownership and is given only to the claimer.
  return { task_id: t.id, status: t.status, holder: live ? t.claim_holder : null, claimed_at: live ? t.claimed_at : null, lease_until: t.lease_until, live };
}

export async function getClaimsMode(db: Db = defaultDb): Promise<ClaimMode> {
  const s = await db.appSettings.findUnique({ where: { id: 'singleton' }, select: { task_claims_mode: true } });
  const m = s?.task_claims_mode;
  return (CLAIM_MODES as readonly string[]).includes(m ?? '') ? (m as ClaimMode) : 'warn';
}

export interface ClaimCaller {
  userId: string;
  role?: string;
  via?: 'session' | 'api_key';
}

export interface ClaimCheck {
  /** Set when a person moved a task that another holder had leased: the caller must add CLEAR_CLAIM_DATA to its write. */
  overridden_holder: string | null;
  /** Writes the claim_override activity line. Call it after the caller's write has succeeded; a no-op when nothing was overridden. */
  logOverride: () => Promise<void>;
}

/**
 * The ownership check before a publish, a send or a status move. No lease or an expired lease means nobody
 * owns the task, so it is allowed (today's behavior). A live lease needs the matching token.
 *  - Any person on a browser session (pm, admin, tech) is a person: the move proceeds, and the caller clears the lease in
 *    the same write (CLEAR_CLAIM_DATA) so the worker's next token call gets claim_lost. Logged as claim_override.
 *  - mode off allows everything; warn logs (console and an ActivityLog row, action claim_warn) and allows;
 *    enforce throws 409 claim_lost. API keys always stay under the check.
 */
export async function assertClaimHeld(
  taskId: string,
  token: string | null | undefined,
  opts: { action?: string; mode?: ClaimMode; caller?: ClaimCaller } = {},
  db: Db = defaultDb,
): Promise<ClaimCheck> {
  const none: ClaimCheck = { overridden_holder: null, logOverride: async () => undefined };
  const t = await db.task.findUnique({ where: { id: taskId }, select: { title: true, claim_holder: true, claim_token: true, lease_until: true } });
  // The common case (nobody holds the task) costs one read and never touches settings.
  if (!t || !t.lease_until || !isLeaseLive(t)) return none;
  const mode = opts.mode ?? (await getClaimsMode(db));
  if (mode === 'off') return none;
  if (token && t.claim_token === token.trim().toLowerCase()) return none;
  const what = opts.action ?? 'change';
  const c = opts.caller;
  // Any person on a browser session (pm, admin or tech) wins over a bot lease. API keys never do.
  if (c && c.via === 'session') {
    return {
      overridden_holder: t.claim_holder,
      logOverride: async () => {
        const u = await db.user.findUnique({ where: { id: c.userId }, select: { name: true } }).catch(() => null);
        await logActivity({
          userId: c.userId,
          action: 'claim_override',
          entityType: 'task',
          entityId: taskId,
          entityName: t.title,
          changes: { message: { from: null, to: `Moved by ${u?.name ?? 'a team member'} while ${t.claim_holder} held it; claim released.` }, action: { from: null, to: what } },
        });
      },
    };
  }
  if (mode === 'warn') {
    console.warn(`claim check (warn): ${what} on task ${taskId} without the live claim held by ${t.claim_holder}`);
    if (c) {
      await logActivity({
        userId: c.userId,
        action: 'claim_warn',
        entityType: 'task',
        entityId: taskId,
        entityName: t.title,
        changes: { holder: { from: null, to: t.claim_holder }, action: { from: null, to: what } },
      });
    }
    return none;
  }
  throw new ApiError(`Another worker holds this task (${t.claim_holder}) until ${t.lease_until.toISOString()}. The ${what} was not applied.`, 409, 'claim_lost');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID.test(s);
}
