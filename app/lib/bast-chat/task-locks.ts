/**
 * Bast chat v2: the locks that make the owner's tap and every chat write that changes what Bast's worker reads
 * atomic with each other (VERIFY-2 N1).
 *
 * The tap recomputes the fingerprint of everything a worker session would read and then writes; a chat comment or
 * edit re-runs its reach check and then writes. Without a lock, either can commit between the other's check and
 * its write. So each of them takes transaction-scoped Postgres advisory locks first, one per task (and one per
 * project whose fields a session reads), and does its check and its write while it holds them:
 *
 *   who                                   locks (`scopeFor`)                                       where
 *   the owner's tap (releaseAction)       the target, every task the card reads, their blockers    actions.ts
 *                                         and dependents, the read tasks' projects
 *   the owner's Undo (undoAction)         the record's task (a comment record: its task), with     actions.ts
 *                                         blockers and dependents; a project record: the project
 *   chat comment op (ops route)           the task, its blockers and dependents                    ops/comment.ts run
 *   chat project op (ops route)           the project                                              ops/project.ts run
 *   chat task PATCH (tasks/[id] route)    the task, its blockers and dependents, any task the      task-filter.ts withChatTaskLock
 *                                         body connects or disconnects
 *
 * Keys are `hashtextextended('bast-chat-task:<id>', 0)` and `...('bast-chat-project:<id>', 0)`, taken one statement
 * at a time in ascending key order, all in one go before any check, so two holders can never wait on each other in
 * a cycle. `lock_timeout` is 10 seconds; a lock that cannot be had in time is a 409 "That is busy right now. Try
 * again." and nothing is written. The locks go when the transaction ends.
 *
 * Only chat paths call this module: a session, a staff key or any other caller never takes these locks and never
 * runs these queries.
 *
 * The holding transaction only holds the locks: the checks and writes inside `fn` may run on other connections
 * (patchTask and its side effects use the shared client). Advisory locks taken by this transaction are seen by every
 * other connection, so that is enough. Code running inside `fn` must never take one of these locks on a DIFFERENT
 * connection (it would wait for itself): ops that lock in `run` do so only when called by the chat, never when the
 * tap or Undo applies them (`ctx.actor` set).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';

type LockDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'> | Prisma.TransactionClient;
type ScopeDb = { task: Pick<PrismaClient['task'], 'findMany'> };

export const LOCK_TIMEOUT_MS = 10_000;
/** Options for the holding transaction: long enough for a patchTask with its side effects under load. */
export const LOCKED_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;
export const BUSY_TEXT = 'That is busy right now. Try again.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LockScope {
  tasks: string[];
  projects: string[];
}
export const EMPTY_SCOPE: LockScope = { tasks: [], projects: [] };

const uniqIds = (xs: readonly (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].sort();

export function mergeScopes(...scopes: LockScope[]): LockScope {
  return { tasks: uniqIds(scopes.flatMap((s) => s.tasks)), projects: uniqIds(scopes.flatMap((s) => s.projects)) };
}

export function isEmptyScope(s: LockScope): boolean {
  return s.tasks.length === 0 && s.projects.length === 0;
}

/** True when every task and project of `inner` is in `outer`. */
export function scopeCovers(outer: LockScope, inner: LockScope): boolean {
  const t = new Set(outer.tasks);
  const p = new Set(outer.projects);
  return inner.tasks.every((x) => t.has(x)) && inner.projects.every((x) => p.has(x));
}

/**
 * The lock scope of a set of tasks: those tasks, the tasks they wait on, the tasks that wait on them, and (with
 * `projects`) the projects of the seed tasks. Deleted tasks count too (more locks, never fewer).
 */
export async function scopeFor(db: ScopeDb, seed: readonly string[], opts: { projects?: boolean; extraProjects?: readonly string[] } = {}): Promise<LockScope> {
  const ids = uniqIds(seed);
  if (ids.length === 0) return { tasks: [], projects: uniqIds(opts.extraProjects ?? []) };
  const rows = (await db.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, project_id: true, blocked_by: { select: { id: true } }, blocking: { select: { id: true } } },
  })) as unknown as { id: string; project_id: string | null; blocked_by?: { id: string }[]; blocking?: { id: string }[] }[];
  const tasks = [...ids];
  const projects: (string | null)[] = [...(opts.extraProjects ?? [])];
  for (const r of rows) {
    for (const b of r.blocked_by ?? []) tasks.push(b.id);
    for (const d of r.blocking ?? []) tasks.push(d.id);
    if (opts.projects) projects.push(r.project_id);
  }
  return { tasks: uniqIds(tasks), projects: uniqIds(projects) };
}

const keysOf = (s: LockScope) => [...s.tasks.map((id) => `bast-chat-task:${id}`), ...s.projects.map((id) => `bast-chat-project:${id}`)];

/**
 * Take the scope's advisory locks inside the CURRENT transaction (`db` must be a transaction client), in ascending key
 * order. Throws a 409 busy ApiError when a lock is not free within LOCK_TIMEOUT_MS.
 */
export async function lockScope(db: LockDb, scope: LockScope): Promise<void> {
  const keys = keysOf(scope);
  if (keys.length === 0) return;
  try {
    await db.$queryRaw`SELECT set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}, true) AS v`;
    const rows = (await db.$queryRaw`SELECT DISTINCT hashtextextended(x, 0) AS k FROM unnest(${keys}::text[]) AS x ORDER BY k`) as { k: bigint }[];
    for (const r of rows ?? []) await db.$executeRaw`SELECT pg_advisory_xact_lock(${r.k})`;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(BUSY_TEXT, 409, 'busy');
  }
}

/**
 * Run `fn` while holding the scope's locks. An empty scope runs `fn` straight away with no transaction. `fn` gets the
 * holding transaction client; most callers ignore it and use the shared client (see the module comment).
 */
export async function withLocks<T>(db: PrismaClient, scope: LockScope, fn: (tx: Prisma.TransactionClient | PrismaClient) => Promise<T>): Promise<T> {
  if (isEmptyScope(scope)) return fn(db);
  return db.$transaction(async (tx) => {
    await lockScope(tx, scope);
    return fn(tx);
  }, LOCKED_TX_OPTIONS);
}
