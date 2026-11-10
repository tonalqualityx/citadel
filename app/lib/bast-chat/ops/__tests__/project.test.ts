/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));

import { getRunnableOp } from '..';

const PROJ = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const NOW = new Date('2026-11-10T15:00:00Z');
const op = getRunnableOp('project')!;
const ctx = () => ({ db: h.db, ownerId: 'o', now: NOW });
let p: any;

beforeEach(() => {
  p = { id: PROJ, name: 'VCDP site', status: 'in_progress', completed_date: null, is_deleted: false };
  h.db = {
    project: {
      findFirst: vi.fn(async () => (p ? { ...p } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => { if (p.id !== where.id || (where.status && p.status !== where.status)) return { count: 0 }; Object.assign(p, data); return { count: 1 }; }),
    },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
  };
});

async function move(status: string) {
  const input = op.validate({ project_id: PROJ, status });
  const prep = await op.prepare(ctx() as any, input, 'chat');
  return { input, prep };
}

describe('project op', () => {
  it('is strict and knows the eight statuses', () => {
    expect(() => op.validate({ project_id: PROJ, status: 'live' })).toThrow();
    expect(() => op.validate({ project_id: PROJ, status: 'done', client_id: PROJ })).toThrow();
  });
  it('a visible project suspended applies, records true before and after, and Undo restores', async () => {
    const { input, prep } = await move('suspended');
    expect(prep.reach.needs_tap).toBe(false);
    const r = await op.run(ctx() as any, input, prep.expect);
    expect(p.status).toBe('suspended');
    expect(r.before).toEqual({ project_id: PROJ, status: 'in_progress', completed_date: null });
    expect(r.after).toEqual({ project_id: PROJ, status: 'suspended', completed_date: null });
    expect(r.summary).toBe('Moved the VCDP site project to suspended.');
    const rec = { before: r.before, after: r.after } as any;
    const u = await op.prepareUndo(ctx() as any, rec);
    expect(u.reach.needs_tap).toBe(true); // putting it back makes it visible to the client again
    expect(u.reach.proposal_kind).toBe('client_show');
  });
  it('done sets the completed date, leaving done clears it; Undo puts it back', async () => {
    const { input, prep } = await move('done');
    const r = await op.run(ctx() as any, input, prep.expect);
    expect(p.completed_date).toEqual(NOW);
    const rec = { before: r.before, after: r.after } as any;
    const u = await op.prepareUndo(ctx() as any, rec);
    expect(await op.undo(ctx() as any, rec, u.expect)).toEqual({ ok: true });
    expect(p).toMatchObject({ status: 'in_progress', completed_date: null });
  });
  it('a hidden project going live is a client show: a tap, nothing written', async () => {
    for (const from of ['quote', 'queue', 'suspended', 'cancelled']) {
      p.status = from;
      const { prep } = await move('ready');
      expect(prep.reach.needs_tap).toBe(true);
      expect(prep.reach.proposal_kind).toBe('client_show');
      expect(h.db.project.updateMany).not.toHaveBeenCalled();
    }
  });
  it('hidden to hidden and visible to visible do not tap', async () => {
    p.status = 'quote';
    expect((await move('queue')).prep.reach.needs_tap).toBe(false);
    p.status = 'ready';
    expect((await move('review')).prep.reach.needs_tap).toBe(false);
  });
  it('refuses a no-change, a missing project and a stale write', async () => {
    await expect(move('in_progress')).rejects.toMatchObject({ statusCode: 409 });
    const { input, prep } = await move('review');
    p.status = 'done';
    await expect(op.run(ctx() as any, input, prep.expect)).rejects.toMatchObject({ statusCode: 409 });
    p = null;
    await expect(move('review')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('Undo refuses when the status moved on', async () => {
    const { input, prep } = await move('review');
    const r = await op.run(ctx() as any, input, prep.expect);
    p.status = 'done';
    await expect(op.prepareUndo(ctx() as any, { before: r.before, after: r.after } as any)).rejects.toMatchObject({ statusCode: 409 });
  });
});
