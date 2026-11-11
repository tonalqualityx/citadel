import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runHomeUndo } from '../../act';

const U = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-12-02T15:00:00Z');
const DAY = 86_400_000;

type W = { user_id: string; evidence_key: string; weight_pct: number; held_until: Date | null };

function makeDb(weight: number, over: { undo_until?: Date; undone_at?: Date | null; action?: string } = {}) {
  const weights: W[] = [{ user_id: U, evidence_key: 'client:x', weight_pct: weight, held_until: null }];
  const action = {
    id: 'a1',
    item_key: null,
    action: over.action ?? 'keeper_learned',
    source: 'keeper',
    before: { states: [], weights: [{ evidence_key: 'client:x', weight_pct: 100, held_until: null, on_undo: 'hold' }] },
    after: { states: [], weights: [{ evidence_key: 'client:x', weight_pct: 105, held_until: null }], line: 'Learned: X work now comes up a little sooner.' },
    undo_until: over.undo_until ?? new Date(NOW.getTime() + 3 * DAY),
    undone_at: over.undone_at ?? null,
    created_at: new Date('2026-11-30T12:00:00Z'),
  };
  const db = {
    weights,
    action,
    homeAction: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; user_id: string } }) => (where.id === 'a1' && where.user_id === U ? { ...action } : null)),
      updateMany: vi.fn(async ({ data }: { data: { undone_at: Date } }) => {
        if (action.undone_at) return { count: 0 };
        action.undone_at = data.undone_at;
        return { count: 1 };
      }),
    },
    homeScoreWeight: {
      updateMany: vi.fn(async ({ where, data }: { where: Partial<W>; data: Partial<W> }) => {
        let n = 0;
        for (const w of weights) {
          if (Object.entries(where).every(([k, v]) => (w as unknown as Record<string, unknown>)[k] === v)) {
            Object.assign(w, data);
            n += 1;
          }
        }
        return { count: n };
      }),
    },
    homeItemState: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(db)),
  };
  return db;
}
const undo = (db: ReturnType<typeof makeDb>) => runHomeUndo(db as unknown as PrismaClient, U, 'a1', NOW);

describe('Undo of a Learned line (through the existing undo, so the chat gets it too)', () => {
  it('puts the weight back to 100 and holds the key for 30 days', async () => {
    const db = makeDb(105);
    const r = await undo(db);
    expect(r).toMatchObject({ ok: true, action_id: 'a1' });
    expect(db.weights[0].weight_pct).toBe(100);
    expect(db.weights[0].held_until?.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(db.action.undone_at).toEqual(NOW);
  });

  it('compare and set: a weight that is no longer what the change wrote is left alone, but still held', async () => {
    const db = makeDb(110);
    await undo(db);
    expect(db.weights[0].weight_pct).toBe(110);
    expect(db.weights[0].held_until?.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it('a second undo is refused and changes nothing', async () => {
    const db = makeDb(105);
    await undo(db);
    db.weights[0].weight_pct = 105;
    db.weights[0].held_until = null;
    await expect(undo(db)).rejects.toMatchObject({ code: 'undo_used' });
    expect(db.weights[0].weight_pct).toBe(105);
  });

  it('after the seven days it is refused', async () => {
    const db = makeDb(105, { undo_until: new Date(NOW.getTime() - 1000) });
    await expect(undo(db)).rejects.toMatchObject({ code: 'undo_expired' });
    expect(db.weights[0].weight_pct).toBe(105);
  });

  it('undoing a Put back restores the weight and the earlier hold instead of holding again', async () => {
    const db = makeDb(100, { action: 'weight_put_back' });
    db.action.before = { states: [], weights: [{ evidence_key: 'client:x', weight_pct: 105, held_until: null, on_undo: 'restore' }] } as never;
    db.action.after = { states: [], weights: [{ evidence_key: 'client:x', weight_pct: 100, held_until: '2026-12-30T00:00:00.000Z' }] } as never;
    await undo(db);
    expect(db.weights[0].weight_pct).toBe(105);
    expect(db.weights[0].held_until).toBeNull();
  });
});
