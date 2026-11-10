/**
 * One connection for a locked request (Bast chat v2, VERIFY-3 X3).
 *
 * A chat write or the owner's tap holds Postgres advisory locks inside an interactive transaction while it checks and
 * writes. If any query of that work went to another pool connection, enough of them at once would hold every
 * connection and wait for one more: the pool starves and every request on the server stalls. So the work runs inside
 * `runOnTransaction(tx, fn)`: while `fn` runs (and everything it awaits), the shared client exported by
 * `lib/db/prisma.ts` sends every model query, raw query and nested `$transaction` to `tx`, the connection that holds
 * the locks. Code deep in the call tree (activity log, notifications, dependencies, receipts) needs no change and
 * cannot open a second connection by accident.
 *
 * Outside such a scope (every request that is not a locked chat request) the store is empty and the shared client is
 * the plain PrismaClient: the same object, the same queries.
 *
 * A scope ends when `fn` settles. A promise started inside it and still running afterwards (a notice sent in the
 * background) goes back to the plain client, so it never uses a transaction that has committed.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export interface TxScope {
  tx: Prisma.TransactionClient;
  open: boolean;
}

const store = new AsyncLocalStorage<TxScope>();

/** The open transaction of the current locked request, or null. */
export function scopedTransaction(): Prisma.TransactionClient | null {
  const s = store.getStore();
  return s && s.open ? s.tx : null;
}

/** Run `fn` with every query of the shared client sent to `tx`. Nested scopes keep the innermost transaction. */
export async function runOnTransaction<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
  const scope: TxScope = { tx, open: true };
  try {
    return await store.run(scope, fn);
  } finally {
    scope.open = false;
  }
}
