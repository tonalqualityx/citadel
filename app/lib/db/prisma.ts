import { PrismaClient } from '@prisma/client';
import { scopedTransaction, withSavepoint } from './scope';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base;

/**
 * The shared client. Outside a locked Bast chat request (lib/db/scope.ts) every property is the PrismaClient's own,
 * bound to it: the same queries as ever. Inside one, model delegates, raw queries and a nested `$transaction` go to the
 * transaction that holds the locks, so a locked request never takes a second pool connection (VERIFY-3 X3).
 */
export const prisma: PrismaClient = new Proxy(base, {
  get(target, prop) {
    const tx = scopedTransaction();
    if (tx) {
      if (prop === '$transaction') {
        // A nested transaction is a savepoint (VERIFY-4 Y9): a throw rolls back its own writes, as a real one would.
        // Its options (timeout, isolation) cannot apply inside the outer transaction and are ignored.
        return async (arg: unknown) =>
          withSavepoint(async () => {
            if (typeof arg === 'function') return (arg as (t: typeof tx) => unknown)(tx);
            const out: unknown[] = [];
            for (const p of arg as Promise<unknown>[]) out.push(await p);
            return out;
          });
      }
      const v = (tx as unknown as Record<PropertyKey, unknown>)[prop];
      if (v !== undefined) return v;
    }
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});
