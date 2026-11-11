import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { applyShifts, learningOn, loadWeights, putBack, resolveEvidence, setLearning, undoWeightRecord, weightRecords } from '../weights-store';

const U = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-30T15:00:00Z');
const DAY = 86_400_000;
const T1 = 'a0000000-0000-4000-8000-000000000001';
const T2 = 'a0000000-0000-4000-8000-000000000002';
const C1 = 'c0000000-0000-4000-8000-00000000000a';

describe('learningOn and setLearning', () => {
  it('a missing settings row means on', async () => {
    const db = { homeKeeperSettings: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient;
    expect(await learningOn(db, U)).toBe(true);
  });
  it('a row says what it says', async () => {
    const db = { homeKeeperSettings: { findUnique: vi.fn(async () => ({ learn_weights: false })) } } as unknown as PrismaClient;
    expect(await learningOn(db, U)).toBe(false);
  });
  it('turning it off creates the owner\'s row with only that switch set', async () => {
    const upsert = vi.fn(async (a: { create: { learn_weights: boolean } }) => ({ learn_weights: a.create.learn_weights }));
    const db = { homeKeeperSettings: { upsert } } as unknown as PrismaClient;
    expect(await setLearning(db, U, false)).toBe(false);
    expect(upsert.mock.calls[0][0]).toMatchObject({ where: { user_id: U }, create: { user_id: U, learn_weights: false }, update: { learn_weights: false } });
  });
});

describe('a stored type:task row is ignored', () => {
  it('loadWeights drops it', async () => {
    const findMany = vi.fn(async () => [
      { evidence_key: 'type:task', label: 'tasks', weight_pct: 120 },
      { evidence_key: 'client:x', label: 'X', weight_pct: 105 },
    ]);
    const db = { homeScoreWeight: { findMany } } as unknown as PrismaClient;
    expect((await loadWeights(db, U)).map((w) => w.evidence_key)).toEqual(['client:x']);
  });
});

describe('loadWeights', () => {
  it('reads the owner\'s weights not at 100', async () => {
    const findMany = vi.fn(async () => [{ evidence_key: 'client:x', label: 'X', weight_pct: 105 }]) as unknown as ReturnType<typeof vi.fn>;
    const db = { homeScoreWeight: { findMany } } as unknown as PrismaClient;
    expect(await loadWeights(db, U)).toHaveLength(1);
    expect((findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ user_id: U, weight_pct: { not: 100 } });
  });
});

describe('applyShifts', () => {
  it('writes one keeper_learned line per shift (source keeper, Undo for 7 days) and the weight row', async () => {
    const created: { data: Record<string, unknown> }[] = [];
    const upserts: Record<string, unknown>[] = [];
    const tx = {
      homeAction: { create: vi.fn(async (a: { data: Record<string, unknown> }) => { created.push(a); return { id: 'act-1' }; }) },
      homeScoreWeight: { upsert: vi.fn(async (a: Record<string, unknown>) => { upserts.push(a); return {}; }) },
    } as unknown as PrismaClient;
    const out = await applyShifts(
      tx,
      U,
      [{ evidence_key: 'client:x', from: 100, to: 105, up: 3, down: 0, items: 3, days: 3, net: 1, strength: 3 }],
      new Map([['client:x', 'Nerd Herd']]),
      new Map(),
      NOW,
    );
    expect(out[0].line).toBe('Learned: Nerd Herd work now comes up a little sooner.');
    const d = created[0].data;
    expect(d).toMatchObject({ user_id: U, action: 'keeper_learned', source: 'keeper', item_key: null });
    expect((d.undo_until as Date).getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(weightRecords(d.before)).toEqual([{ evidence_key: 'client:x', weight_pct: 100, held_until: null, on_undo: 'hold' }]);
    expect(weightRecords(d.after)[0].weight_pct).toBe(105);
    expect((d.after as { line: string }).line).toContain('Learned:');
    expect(upserts[0]).toMatchObject({ create: { weight_pct: 105, signals_up: 3, changed_by_action_id: 'act-1' } });
  });
});

describe('undoWeightRecord (compare and set)', () => {
  const before = { evidence_key: 'client:x', weight_pct: 100, held_until: null, on_undo: 'hold' as const };
  const after = { evidence_key: 'client:x', weight_pct: 105, held_until: null };
  it('puts the weight back only if it still holds the value the change wrote, and holds the key 30 days', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { homeScoreWeight: { updateMany } } as unknown as PrismaClient;
    expect(await undoWeightRecord(tx, U, before, after, NOW)).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: { weight_pct: number; held_until: Date } }])[0];
    expect(arg.where).toEqual({ user_id: U, evidence_key: 'client:x', weight_pct: 105 });
    expect(arg.data.weight_pct).toBe(100);
    expect(arg.data.held_until.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });
  it('when the weight moved on since, it is left alone but the key is still held', async () => {
    const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    const updateMany = vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { calls.push(a); return { count: calls.length === 1 ? 0 : 1 }; });
    const tx = { homeScoreWeight: { updateMany } } as unknown as PrismaClient;
    expect(await undoWeightRecord(tx, U, before, after, NOW)).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1].data).toHaveProperty('held_until');
    expect(calls[1].data).not.toHaveProperty('weight_pct');
  });
});

describe('putBack', () => {
  function fakeTx(row: { id: string; weight_pct: number; held_until: Date | null } | null, count = 1) {
    const actions: Record<string, unknown>[] = [];
    const updateMany = vi.fn(async () => ({ count }));
    const tx = {
      homeScoreWeight: { findUnique: vi.fn(async () => row), updateMany },
      homeAction: { create: vi.fn(async (a: { data: Record<string, unknown> }) => { actions.push(a.data); return { id: 'act-9' }; }) },
    };
    return { db: { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaClient, actions, updateMany };
  }
  it('sets the weight to 100, holds 30 days, and writes its own home action with Undo for 24 hours', async () => {
    const { db, actions, updateMany } = fakeTx({ id: 'w1', weight_pct: 105, held_until: null });
    const r = await putBack(db, U, 'client:x', NOW);
    expect(r.action_id).toBe('act-9');
    expect(actions[0]).toMatchObject({ user_id: U, action: 'weight_put_back', source: 'home' });
    expect((actions[0].undo_until as Date).getTime()).toBe(NOW.getTime() + DAY);
    const arg = (updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: { weight_pct: number; held_until: Date } }])[0];
    expect(arg.where).toEqual({ id: 'w1', weight_pct: 105 });
    expect(arg.data.weight_pct).toBe(100);
    expect(arg.data.held_until.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(weightRecords(actions[0].before)[0]).toMatchObject({ weight_pct: 105, on_undo: 'restore' });
  });
  it('404 when the key is not learned, or already at 100', async () => {
    await expect(putBack(fakeTx(null).db, U, 'client:x', NOW)).rejects.toMatchObject({ statusCode: 404 });
    await expect(putBack(fakeTx({ id: 'w1', weight_pct: 100, held_until: null }).db, U, 'client:x', NOW)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('409 when the weight changed under it', async () => {
    await expect(putBack(fakeTx({ id: 'w1', weight_pct: 105, held_until: null }, 0).db, U, 'client:x', NOW)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('resolveEvidence', () => {
  function db() {
    const task = { findMany: vi.fn(async () => [
      { id: T1, client_id: C1, project_id: null, sop_id: null, tags: [] },
      { id: T2, client_id: C1, project_id: null, sop_id: null, tags: ['security'] },
    ]) };
    return {
      task,
      wait: { findMany: vi.fn(async () => []) },
      project: { findMany: vi.fn(async () => []) },
      oracleSession: { findMany: vi.fn(async () => []) },
      emailAsk: { findFirst: vi.fn(async () => ({ client_id: null, project_id: null, from_email: 'Pat@Example.com', intent: 'sales' })) },
      client: { findMany: vi.fn(async () => [{ id: C1, name: 'Nerd Herd' }]) },
      sop: { findMany: vi.fn(async () => []) },
    };
  }
  it('rebuilds a task\'s evidence and labels, and marks an emergency-tagged one as protected', async () => {
    const d = db();
    const r = await resolveEvidence(d as unknown as PrismaClient, U, [`task:${T1}`, `task:${T2}`]);
    expect(r.evidence.get(`task:${T1}`)).toEqual({ keys: [`client:${C1}`], protected: false });
    expect(r.evidence.get(`task:${T2}`)?.protected).toBe(true);
    expect(r.labels.get(`client:${C1}`)).toBe('Nerd Herd');
    expect(r.labels.has('type:task')).toBe(false);
  });
  it('reads tasks only when assigned to the owner (a bot\'s task never resolves)', async () => {
    const d = db();
    await resolveEvidence(d as unknown as PrismaClient, U, [`task:${T1}`]);
    expect((d.task.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).toMatchObject({ assignee_id: U });
  });
  it('a thread with no client carries the sender, and a sales thread is protected from down shifts', async () => {
    const d = db();
    const r = await resolveEvidence(d as unknown as PrismaClient, U, ['thread:acct@x.co:thr-1']);
    expect(r.evidence.get('thread:acct@x.co:thr-1')).toEqual({ keys: ['type:thread', 'sender:pat@example.com'], protected: true });
    expect(r.labels.get('sender:pat@example.com')).toBe('mail from pat@example.com');
  });
  it('a key it cannot parse or find resolves to nothing', async () => {
    const d = db();
    const r = await resolveEvidence(d as unknown as PrismaClient, U, ['nonsense', 'hands:week', `crisis:${T1}`]);
    expect(r.evidence.size).toBe(0);
  });
});
