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
 * a cycle. Each request waits at most 8 seconds in all, counted from when it reaches this process's gate for the same
 * keys (`throughGate`, below: it waits there without a pool connection, VERIFY-6 A1); a lock that cannot be had in time
 * is a 409 "That is busy right now. Try again." and nothing is written. The locks go when the transaction ends.
 *
 * Only chat paths call this module: a session, a staff key or any other caller never takes these locks and never
 * runs these queries.
 *
 * THE LOCK ORDER OF THE CHAT LANE (VERIFY-6 A1). Every row and advisory lock each chat path takes, in the order it
 * takes them. "own stmt" is a statement of its own, committed at once (it holds that row for that statement only).
 *
 * Before any of it, a request with advisory keys waits at this process's gate for the same keys in the same order
 * (`throughGate`), holding no connection and no database lock.
 *
 *   path                               1 usage row     2 advisory      3 rows (action, task, comment,      4 conversation   5 usage row
 *                                      (own stmt)      locks           project, wait, ask, home)           row, events      (last stmt)
 *   owner's message (appendMikeMessage)                                                                     conv, event      bumpUsage
 *   daemon events, cost, acks                                                                               conv, events,    bumpUsage
 *     (appendWorkerEvents)                                                                                  Mike rows
 *   daemon PATCH of the conversation                                                                        conv (own stmt)
 *   stop (requestStop)                                                                                      conv, event
 *   inbox: stale messages expire                                                                            conv, Mike rows,
 *                                                                                                           note
 *   chat task PATCH (tasks/[id])       reserveWrite    task scope      task rows (patchTask), then the
 *                                                                      proposal or the record (insert)
 *   chat task create (POST /tasks)     reserveWrite                    task insert, then the record
 *   proposal store (storeProposal)     reserveWrite                    the proposal (insert)
 *   op: comment                        reserveWrite    task scope      comment insert, the record
 *   op: project                        reserveWrite    project         project row, the record
 *   op: wait, email ask                reserveWrite                    wait or ask rows, the record
 *   op: home (own transaction)         reserveWrite                    home rows; then the record
 *   tap (releaseAction)                                full scope      claim the proposal, the write,     conv, note
 *                                                                      rewrites and their records, the
 *                                                                      undone record, the proposal
 *   tap that dies (DeadTap)                                            mark failed (own stmt)              conv, note (own
 *                                                                                                           transaction, best effort)
 *   decline                                                            claim (own stmt)                    conv, note (best effort)
 *   Undo (undoAction), undo-since      (none: the      record scope    the restore, or a proposal          conv, note
 *     (one undoAction at a time)       owner's)                        (insert), the record
 *
 * The rules that make a cycle impossible:
 * - The day's usage row (one per owner per day, shared by every chat write and message) is taken either alone in its
 *   own statement before anything else (reserveWrite), or as the LAST statement of a transaction (bumpUsage). Whoever
 *   holds it waits for nothing, so it is never part of a cycle. (Before VERIFY-6 the ops route reserved inside its
 *   locked transaction and then waited for a task lock: tap, send and op closed a cycle through this row.)
 * - The conversation row is taken after every advisory lock and task-side row of that transaction, and a transaction
 *   holding it then only inserts that conversation's events, updates the conversation, updates its own Mike rows, and
 *   takes the usage row last. So nobody holding it ever waits for a task-side lock.
 * - Advisory locks are taken all at once, sorted, as the first statements of their transaction (lockScope).
 * - Task-side rows are written only under the advisory locks of their task scope, or by staff writers, which take no
 *   advisory lock, no conversation row and no usage row; the two can only meet on task rows, as two staff writers do
 *   on main.
 *
 * Everything inside `fn` runs on the holding transaction's own connection (VERIFY-3 X3): `withLocks` runs `fn` under
 * `runOnTransaction` (lib/db/scope.ts), so every query of the shared client, from patchTask down to the activity log
 * and the notices, goes to that one connection. A locked request never waits for a second pool connection while it
 * holds one, so the pool cannot starve however many arrive at once, and every write of the request commits or rolls
 * back together (a tap that dies half way leaves its proposal exactly as it was: VERIFY-3 X4). Locks taken again
 * inside `fn` (an op's `run`) are taken on the same connection and simply stack.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '@/lib/api/errors';
import { TX_ABORTED_TEXT, assertAlive, openScope, runAfterCommit, runInScope, scopedTransaction } from '@/lib/db/scope';

type LockDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'> | Prisma.TransactionClient;
type ScopeDb = { task: Pick<PrismaClient['task'], 'findMany'> };

export const LOCK_TIMEOUT_MS = 8_000;
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
  // A request that already waited at this process's gate waits on the database only for what is left of its time.
  const deadline = gateDeadline.getStore();
  const wait = deadline === undefined ? LOCK_TIMEOUT_MS : Math.min(LOCK_TIMEOUT_MS, Math.max(MIN_DB_WAIT_MS, deadline - Date.now()));
  try {
    await db.$queryRaw`SELECT set_config('lock_timeout', ${`${wait}ms`}, true) AS v`;
    const rows = (await db.$queryRaw`SELECT DISTINCT hashtextextended(x, 0) AS k FROM unnest(${keys}::text[]) AS x ORDER BY k`) as { k: bigint }[];
    for (const r of rows ?? []) await db.$executeRaw`SELECT pg_advisory_xact_lock(${r.k})`;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(BUSY_TEXT, 409, 'busy');
  }
}

// ---------------------------------------------------------------------------------------------
// The in-process gate (VERIFY-6 A1, the held row)
// ---------------------------------------------------------------------------------------------

/**
 * Before a locked request takes a pool connection, it waits IN THIS PROCESS for the same keys its advisory locks will
 * take (same keys, same ascending order, same LOCK_TIMEOUT_MS). So when something holds a task (an outside transaction
 * on its row, a slow tap), only one request per task waits on the database with a connection; the others wait here,
 * holding no connection, and answer busy when their time is up. Without it, five chat requests on one held task held
 * five connections for 8 to 16 seconds, and on a pool of 3 every other request of the app timed out (VERIFY-6 hold).
 * The advisory locks stay the rule between processes; this only keeps one process from spending its pool on waiting.
 * A request already inside a transaction never waits here.
 */
const gateTails = new Map<string, Promise<void>>();
/** When this request's time to wait for its locks runs out (set by `throughGate`). */
const gateDeadline = new AsyncLocalStorage<number>();
/** The least a request that got through the gate may still wait on the database for its locks. */
const MIN_DB_WAIT_MS = 1_000;

async function enterGate(keys: string[], deadline: number): Promise<() => void> {
  const releases: (() => void)[] = [];
  const leave = () => {
    for (const r of releases.splice(0).reverse()) r();
  };
  for (const key of [...new Set(keys)].sort()) {
    const prev = gateTails.get(key) ?? Promise.resolve();
    let open!: () => void;
    const mine = new Promise<void>((r) => (open = r));
    const tail = prev.then(() => mine);
    gateTails.set(key, tail);
    releases.push(() => {
      open();
      if (gateTails.get(key) === tail) gateTails.delete(key);
    });
    const left = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      prev.then(() => false),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(true), Math.max(0, left)))),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      leave();
      throw new ApiError(BUSY_TEXT, 409, 'busy');
    }
  }
  return leave;
}

/** Run `fn` after this process's gate for the scope (see above); straight away inside a transaction or for no keys. */
export async function throughGate<T>(scope: LockScope, fn: () => Promise<T>): Promise<T> {
  const keys = keysOf(scope);
  if (keys.length === 0 || scopedTransaction()) return fn();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const leave = await enterGate(keys, deadline);
  try {
    return await gateDeadline.run(deadline, fn);
  } finally {
    leave();
  }
}

/** A database error that means "someone else holds it" (lock timeout, deadlock) or a transaction that ran out of time: all roll back. */
export function isBusyError(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === 'busy';
  const o = e as { code?: unknown; message?: unknown; meta?: { code?: unknown } } | null;
  const text = `${String(o?.code ?? '')} ${String(o?.meta?.code ?? '')} ${String(o?.message ?? '')}`;
  return /55P03|40P01|P2024|P2028|P2034|lock timeout|Timed out fetching a new connection|deadlock detected|Transaction already closed|expired transaction/i.test(text);
}

/**
 * Run `fn` while holding the scope's locks, with every query of the shared client on the holding transaction (see the
 * module comment). Everything `fn` writes commits together when it returns, and rolls back if it throws. An empty
 * scope runs `fn` straight away with no transaction. A lock that cannot be had, a deadlock or a transaction that ran
 * out of time is a 409 busy with nothing written.
 */
export async function withLocks<T>(db: PrismaClient, scope: LockScope, fn: (tx: Prisma.TransactionClient | PrismaClient) => Promise<T>): Promise<T> {
  if (isEmptyScope(scope)) return fn(db);
  return throughGate(scope, () => inLockedTransaction(db, (tx) => lockScope(tx, scope), fn));
}

/**
 * The one way locked work runs (withLocks here, the ops route's write in ops/apply.ts): a transaction, `before` (the
 * locks), then `fn` in a scope on the same connection. Before the commit the transaction must still be alive (an abort
 * is a 500 "That didn't go through. Try again.", never a success with nothing written); after it, the scope's
 * best-effort queue runs outside the transaction (lib/db/scope.ts). A rollback drops the queue.
 */
export async function inLockedTransaction<T>(
  db: PrismaClient,
  before: (tx: Prisma.TransactionClient) => Promise<void>,
  fn: (tx: Prisma.TransactionClient | PrismaClient) => Promise<T>,
): Promise<T> {
  let scoped: ReturnType<typeof openScope> | null = null;
  let result: T;
  try {
    result = await db.$transaction(async (tx) => {
      await before(tx);
      scoped = openScope(tx);
      const r = await runInScope(scoped, () => fn(tx));
      await assertAlive(tx);
      return r;
    }, LOCKED_TX_OPTIONS);
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'tx_aborted') throw new ApiError(TX_ABORTED_TEXT, 500, 'tx_aborted');
    if (!(e instanceof ApiError) && isBusyError(e)) throw new ApiError(BUSY_TEXT, 409, 'busy');
    throw e;
  }
  if (scoped) await runAfterCommit(scoped);
  return result;
}
