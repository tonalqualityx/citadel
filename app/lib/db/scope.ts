/**
 * One connection for a locked request (Bast chat v2, VERIFY-3 X3), with main's best-effort meaning kept (VERIFY-4 R4).
 *
 * A chat write or the owner's tap holds Postgres advisory locks inside an interactive transaction while it checks and
 * writes. If any query of that work went to another pool connection, enough of them at once would hold every
 * connection and wait for one more: the pool starves. So the work runs inside a scope (`openScope` / `runInScope`):
 * while it runs, the shared client exported by `lib/db/prisma.ts` sends every model query, raw query and nested
 * `$transaction` to the transaction that holds the locks.
 *
 * One transaction changes what "best effort" means: on main each statement stands alone, so a write that fails and is
 * caught (an activity log row whose name is too long) costs only itself; inside a transaction the first failed
 * statement aborts everything after it. So, inside a scope:
 * - `deferUntilCommit(fn)`: best-effort work and everything that leaves the building (the activity log, notifications
 *   with their Slack and email sends) is queued and runs after the transaction commits, outside it, on the plain
 *   client, each in its own try and catch, exactly as tolerant as on main. If the transaction rolls back, the queue is
 *   dropped: nothing is sent for a change that did not happen.
 * - `withSavepoint(fn)`: a write that must be part of the change but may fail without failing it (the chat's change
 *   record, the portal clock) runs inside a savepoint, so its failure rolls back only itself. A nested `$transaction`
 *   is a savepoint too (lib/db/prisma.ts).
 * - The caller checks the transaction is still alive before it commits (`assertAlive`), so an abort that slipped past
 *   all this surfaces as an error, never as a success with nothing written.
 *
 * Outside a scope (every request that is not a locked chat request) nothing here does anything: the shared client is
 * the plain PrismaClient, `deferUntilCommit` returns false so the caller runs inline, and `withSavepoint` just calls fn.
 *
 * Savepoint blocks of one scope must not run at the same time (the chat paths await each one in turn).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export interface TxScope {
  tx: Prisma.TransactionClient;
  open: boolean;
  afterCommit: { label: string; run: () => Promise<unknown> }[];
  savepoints: number;
}

const store = new AsyncLocalStorage<TxScope>();

function current(): TxScope | null {
  const s = store.getStore();
  return s && s.open ? s : null;
}

/** The open transaction of the current locked request, or null. */
export function scopedTransaction(): Prisma.TransactionClient | null {
  return current()?.tx ?? null;
}

export function openScope(tx: Prisma.TransactionClient): TxScope {
  return { tx, open: true, afterCommit: [], savepoints: 0 };
}

/** Run `fn` inside `scope` (every query of the shared client goes to its transaction). Closes the scope when fn settles. */
export async function runInScope<T>(scope: TxScope, fn: () => Promise<T>): Promise<T> {
  try {
    return await store.run(scope, fn);
  } finally {
    scope.open = false;
  }
}

/** Shorthand for a scope whose queue the caller does not need. */
export async function runOnTransaction<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
  return runInScope(openScope(tx), fn);
}

/**
 * Inside a scope, queue `fn` to run after the commit and return true; outside, return false (the caller runs it now).
 * Usage: `if (deferUntilCommit('activity log', () => logActivity(input))) return;`
 */
export function deferUntilCommit(label: string, fn: () => Promise<unknown>): boolean {
  const s = current();
  if (!s) return false;
  s.afterCommit.push({ label, run: fn });
  return true;
}

/** Run a scope's queue after its transaction committed. Each item stands alone, as on main. */
export async function runAfterCommit(scope: TxScope): Promise<void> {
  for (const item of scope.afterCommit.splice(0)) {
    try {
      await item.run();
    } catch (e) {
      console.error(`after commit: ${item.label} failed`, e instanceof Error ? e.message : 'error');
    }
  }
}

/** Inside a scope, run `fn` in a savepoint (its failure rolls back only its own writes, then rethrows). Outside, just fn. */
export async function withSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const s = current();
  if (!s) return fn();
  const name = `bast_sp_${++s.savepoints}`;
  await s.tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const r = await fn();
    await s.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return r;
  } catch (e) {
    await s.tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
}

export const TX_ABORTED_TEXT = "That didn't go through. Try again.";

/** Throws when the transaction was aborted by a failed statement (Postgres would turn the commit into a rollback). */
export async function assertAlive(tx: Prisma.TransactionClient): Promise<void> {
  try {
    await tx.$queryRaw`SELECT 1 AS alive`;
  } catch (e) {
    const err = new Error(TX_ABORTED_TEXT) as Error & { code: string; cause?: unknown };
    err.code = 'tx_aborted';
    err.cause = e;
    throw err;
  }
}
