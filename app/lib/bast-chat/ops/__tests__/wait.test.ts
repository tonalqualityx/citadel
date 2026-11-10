/* eslint-disable @typescript-eslint/no-explicit-any */
// Op `wait`: the real wait actions on an in-memory table. Undo for the five that can be undone; a finished wait cannot.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));

import { getRunnableOp } from '..';
import { BAST_USER_ID, SABEEN_USER_ID, MIKE_USER_ID } from '../../gate-mirror';

const WAIT = '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';
const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-10T15:00:00Z'); // a Tuesday
const op = getRunnableOp('wait')!;

let w: any;
let events: any[];
let users: Record<string, any>;
const ctx = () => ({ db: h.db, ownerId: OWNER, now: NOW });

function makeDb() {
  return {
    wait: {
      findUnique: vi.fn(async () => (w ? { ...w } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ok = w && w.id === where.id && (!where.updated_at || w.updated_at.getTime() === where.updated_at.getTime()) && (!where.state || w.state === where.state);
        if (!ok) return { count: 0 };
        Object.assign(w, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: any) => { Object.assign(w, data, { updated_at: new Date(NOW.getTime() + 1000) }); return { ...w }; }),
    },
    waitEvent: { create: vi.fn(async ({ data }: any) => { events.push(data); }), findFirst: vi.fn(async ({ where }: any) => [...events].reverse().find((e) => e.kind === where.kind) ?? null) },
    user: { findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null) },
    function: { findUnique: vi.fn(async () => null) },
    projectTeamAssignment: { findMany: vi.fn(async () => []) },
    accord: { findUnique: vi.fn(async () => null) },
    $transaction: undefined as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  users = { [OWNER]: { is_active: true, name: 'Mike D' }, [SABEEN_USER_ID]: { is_active: true, name: 'Sabeen K' }, [BAST_USER_ID]: { is_active: true, name: 'Bast' } };
  w = { id: WAIT, template_key: 'proposal.follow_up', step: 1, title: 'Rotate passwords', state: 'waiting', due_at: new Date('2026-11-12T22:00:00Z'), paused_until: null, paused_remaining_ms: null, extended_bd_total: 0, extension_count: 0, owner_user_id: MIKE_USER_ID, owner_function_id: null, escalated_to_user_id: null, stand_in_user_id: null, owner_contact_id: null, nag_level: 0, last_nag_at: null, fired_at: null, claimed_at: null, updated_at: new Date('2026-11-09T12:00:00Z'), action_payload: null };
  users[MIKE_USER_ID] = { is_active: true, name: 'Mike D' };
  h.db = makeDb();
  h.db.$transaction = async (fn: any) => { const snapshot = { ...w }; const ev = events.length; try { return await fn(h.db); } catch (e) { w = snapshot; events.length = ev; throw e; } };
});

async function doIt(body: object) {
  const input = op.validate({ wait_id: WAIT, ...body });
  const p = await op.prepare(ctx() as any, input, 'chat');
  return { input, p };
}
async function apply(body: object) {
  const { input, p } = await doIt(body);
  expect(p.reach.needs_tap).toBe(false);
  return op.run(ctx() as any, input, p.expect);
}
const record = (r: any, action: string) => ({ id: 'a1', target_type: 'wait', target_id: WAIT, before: r.before, after: r.after, undo_until: new Date(NOW.getTime() + 86400000), action }) as any;

describe('wait op input', () => {
  it('is strict, and cannot name any other resolution', () => {
    expect(() => op.validate({ wait_id: WAIT, action: 'resolve', resolution: 'approved' })).toThrow();
    expect(() => op.validate({ wait_id: WAIT, action: 'complete', resolution: 'approved' })).toThrow();
    expect(() => op.validate({ wait_id: WAIT, action: 'redate', due_at: 'tomorrow' })).toThrow();
    expect(() => op.validate({ wait_id: WAIT, action: 'cancel', user_id: OWNER })).toThrow();
    expect(() => op.validate({ wait_id: WAIT, action: 'extend', business_days: 99 })).toThrow();
  });
});

describe('wait op', () => {
  it('redate: applies with a WaitEvent, records true before and after, Undo restores', async () => {
    const r = await apply({ action: 'redate', due_at: '2026-11-20T22:00:00Z' });
    expect(w.due_at.toISOString()).toBe('2026-11-20T22:00:00.000Z');
    expect(events.at(-1)).toMatchObject({ kind: 'extended', source: 'user', actor_user_id: OWNER });
    expect(r.before).toMatchObject({ wait_id: WAIT, action: 'redate', due_at: '2026-11-12T22:00:00.000Z' });
    expect(r.after).toMatchObject({ due_at: '2026-11-20T22:00:00.000Z' });
    expect(r.summary).toMatch(/^"Rotate passwords" now comes due /);
    const rec = record(r, 'redate');
    const u = await op.prepareUndo(ctx() as any, rec);
    expect(u.reach.needs_tap).toBe(false);
    expect(await op.undo(ctx() as any, rec, u.expect)).toEqual({ ok: true });
    expect(w.due_at.toISOString()).toBe('2026-11-12T22:00:00.000Z');
  });
  it('extend by business days: counters move and Undo puts them back', async () => {
    const r = await apply({ action: 'extend', business_days: 2 });
    expect(w.extension_count).toBe(1);
    expect(w.extended_bd_total).toBe(2);
    const rec = record(r, 'extend');
    const u = await op.prepareUndo(ctx() as any, rec);
    await op.undo(ctx() as any, rec, u.expect);
    expect(w.extension_count).toBe(0);
    expect(w.extended_bd_total).toBe(0);
    expect(w.due_at.toISOString()).toBe('2026-11-12T22:00:00.000Z');
  });
  it('extend past the cap is refused and rolled back (never flips to needs_human)', async () => {
    w.extension_count = 2;
    const { input, p } = await doIt({ action: 'extend', business_days: 1 });
    await expect(op.run(ctx() as any, input, p.expect)).rejects.toMatchObject({ statusCode: 409 });
    expect(w.state).toBe('waiting');
    expect(events).toHaveLength(0);
  });
  it('pause then resume, each with its Undo', async () => {
    const r = await apply({ action: 'pause', until: '2026-11-18T12:00:00Z' });
    expect(w.state).toBe('paused');
    const rec = record(r, 'pause');
    const u = await op.prepareUndo(ctx() as any, rec);
    await op.undo(ctx() as any, rec, u.expect);
    expect(w.state).toBe('waiting');
    expect(w.paused_until).toBeNull();
    await apply({ action: 'pause', until: '2026-11-18T12:00:00Z' });
    const r2 = await apply({ action: 'resume' });
    expect(w.state).toBe('waiting');
    const rec2 = record(r2, 'resume');
    const u2 = await op.prepareUndo(ctx() as any, rec2);
    await op.undo(ctx() as any, rec2, u2.expect);
    expect(w.state).toBe('paused');
    expect(typeof w.paused_remaining_ms).toBe('bigint');
  });
  it('reassign to a person applies and Undo restores the owner', async () => {
    const r = await apply({ action: 'reassign', owner_user_id: SABEEN_USER_ID });
    expect(w.owner_user_id).toBe(SABEEN_USER_ID);
    expect(r.summary).toBe('"Rotate passwords" is on Sabeen now.');
    const rec = record(r, 'reassign');
    const u = await op.prepareUndo(ctx() as any, rec);
    await op.undo(ctx() as any, rec, u.expect);
    expect(w.owner_user_id).toBe(MIKE_USER_ID);
  });
  it('reassign to Bast needs a tap (its task step would file a Bast task) and changes nothing', async () => {
    const { p } = await doIt({ action: 'reassign', owner_user_id: BAST_USER_ID });
    expect(p.reach.needs_tap).toBe(true);
    expect(p.reach.starts[0].rule).toBe('wait_for_bast');
    expect(w.owner_user_id).toBe(MIKE_USER_ID);
  });
  it('redating a wait Bast already owns needs a tap; pausing it does not', async () => {
    w.owner_user_id = BAST_USER_ID;
    expect((await doIt({ action: 'redate', due_at: '2026-11-11T12:00:00Z' })).p.reach.needs_tap).toBe(true);
    expect((await doIt({ action: 'pause', until: '2026-11-18T12:00:00Z' })).p.reach.needs_tap).toBe(false);
  });
  it('undoing a pause on a Bast wait would resume it for Bast: a tap', async () => {
    w.owner_user_id = BAST_USER_ID;
    const r = await apply({ action: 'pause', until: '2026-11-18T12:00:00Z' });
    const u = await op.prepareUndo(ctx() as any, record(r, 'pause'));
    expect(u.reach.needs_tap).toBe(true);
  });
  it('reassign to someone who is not active is refused', async () => {
    users[SABEEN_USER_ID].is_active = false;
    await expect(doIt({ action: 'reassign', owner_user_id: SABEEN_USER_ID })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('complete and cancel finish the wait, say they cannot be undone, and refuse Undo', async () => {
    for (const [action, resolution] of [['complete', 'completed'], ['cancel', 'cancelled']] as const) {
      w.state = 'waiting';
      w.resolution = null;
      const r = await apply({ action });
      expect(w.state).toBe('done');
      expect(w.resolution).toBe(resolution);
      expect(r.undoable).toBe(false);
      expect(r.summary.endsWith("It can't be undone.")).toBe(true);
      await expect(op.prepareUndo(ctx() as any, { ...record(r, action), undo_until: null })).rejects.toMatchObject({ statusCode: 409 });
      await expect(op.prepareUndo(ctx() as any, record(r, action))).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it('a finished wait takes no further change', async () => {
    w.state = 'done';
    await expect(doIt({ action: 'redate', due_at: '2026-11-20T22:00:00Z' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a price review wait is refused, for every action', async () => {
    w.template_key = 'charter.price_review';
    w.step = 2;
    await expect(doIt({ action: 'complete' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(doIt({ action: 'pause', until: '2026-11-18T12:00:00Z' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('the write lands only on the wait as read: a change in between is refused', async () => {
    const { input, p } = await doIt({ action: 'redate', due_at: '2026-11-20T22:00:00Z' });
    w.updated_at = new Date('2026-11-10T14:59:00Z');
    await expect(op.run(ctx() as any, input, p.expect)).rejects.toMatchObject({ statusCode: 409 });
    expect(w.due_at.toISOString()).toBe('2026-11-12T22:00:00.000Z');
  });
  it('Undo refuses when the wait moved on since', async () => {
    const r = await apply({ action: 'redate', due_at: '2026-11-20T22:00:00Z' });
    w.due_at = new Date('2026-11-25T22:00:00Z');
    await expect(op.prepareUndo(ctx() as any, record(r, 'redate'))).rejects.toMatchObject({ statusCode: 409 });
  });
});
