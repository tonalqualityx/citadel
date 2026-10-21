import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { prismaSweepStore } from './prisma-store';

// Mock-level checks of the SQL-shaping calls. They run in CI without a database; the Postgres
// integration test (prisma-store.integration.test.ts) proves the same behavior for real.
function fakeDb(count: number) {
  const updateMany = vi.fn(async () => ({ count }));
  const findUnique = vi.fn(async () => ({ id: 'w1' }));
  const db = { wait: { updateMany, findUnique }, waitEvent: { findUnique: vi.fn(async () => null) } };
  return { db: db as unknown as PrismaClient, updateMany, findUnique, waitEvent: db.waitEvent };
}

describe('claim', () => {
  const now = new Date('2026-10-21T14:00:00Z');
  const stale = new Date('2026-10-21T13:50:00Z');

  it('re-checks state, fired_at, due_at and the claim age in the WHERE itself', async () => {
    const { db, updateMany } = fakeDb(1);
    await prismaSweepStore(db).claim('w1', now, stale);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'w1',
        state: 'waiting',
        fired_at: null,
        due_at: { lte: now },
        OR: [{ claimed_at: null }, { claimed_at: { lt: stale } }],
      },
      data: { claimed_at: now },
    });
  });

  it('returns null when the conditional update matched nothing (extended, fired, or claimed elsewhere)', async () => {
    const { db, findUnique } = fakeDb(0);
    expect(await prismaSweepStore(db).claim('w1', now, stale)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns the row only when it won the claim', async () => {
    const { db } = fakeDb(1);
    expect(await prismaSweepStore(db).claim('w1', now, stale)).toEqual({ id: 'w1' });
  });
});

describe('eventSeenForWait', () => {
  it('looks up the exact key, never a prefix', async () => {
    const { db, waitEvent } = fakeDb(0);
    await prismaSweepStore(db).eventSeenForWait('abc', 'w1');
    expect(waitEvent.findUnique).toHaveBeenCalledWith({ where: { event_id: 'abc:w1' }, select: { id: true } });
  });
});
