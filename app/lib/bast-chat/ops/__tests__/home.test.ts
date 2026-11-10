/* eslint-disable @typescript-eslint/no-explicit-any */
// Op `home`: the owner's own rows through the home screen's reducer, whatever the request says.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any, run: vi.fn(), undo: vi.fn(), action: null as any, state: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/act', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/act')>()),
  runHomeAct: h.run,
  runHomeUndo: h.undo,
}));
vi.mock('@/lib/home/state', () => ({ getHomeAction: vi.fn(async () => h.action), getItemState: vi.fn(async () => h.state) }));

import { getRunnableOp } from '..';
import { opSummary } from '../../actions';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const TASK = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const KEY = `task:${TASK}`;
const NOW = new Date('2026-11-10T15:00:00Z');
const op = getRunnableOp('home')!;
const ctx = (over: object = {}) => ({ db: h.db, ownerId: OWNER, now: NOW, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.db = {
    userPreference: { findUnique: vi.fn(async () => ({ home_view: 'home' })) },
    task: { findUnique: vi.fn(async () => ({ title: 'Grok rescan', tags: [] })) },
  };
  h.run.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: KEY, message: 'Back tomorrow at 9:00.' });
  h.action = { id: '77777777-7777-4777-8777-777777777777', before: { states: [{ item_key: KEY, existed: false, fields: { park_count: 0 } }] }, after: { states: [{ item_key: KEY, fields: { park_count: 1 } }] } };
  h.state = { view_at: new Date('2026-11-11T14:00:00Z') };
});

describe('home op', () => {
  it('is registered once under its name and target type', () => {
    expect(op.name).toBe('home');
    expect(op.target_type).toBe('home');
    expect(getRunnableOp('task')).toBeNull();
  });
  it('refuses the screen\'s record action and any user id (strict)', () => {
    expect(() => op.validate({ action: 'record', item_key: KEY, did: 'done' })).toThrow();
    expect(() => op.validate({ action: 'not_now', item_key: KEY, user_id: 'x' })).toThrow();
    expect(() => op.validate({ action: 'not_now', item_key: KEY, owner_id: OWNER })).toThrow();
    expect(() => op.validate({ action: 'not_now', item_key: 'bad' })).toThrow();
  });
  it('applies through runHomeAct for the configured owner only, and records the true before and after', async () => {
    const input = op.validate({ action: 'not_now', item_key: KEY });
    const r = await op.run(ctx() as any, input, {});
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][1]).toBe(OWNER);
    expect(h.run.mock.calls[0][2]).toEqual({ action: 'not_now', item_key: KEY });
    expect(h.db.userPreference.findUnique).toHaveBeenCalledWith({ where: { user_id: OWNER }, select: { home_view: true } });
    expect(r.target_id).toBe('77777777-7777-4777-8777-777777777777');
    expect(r.before).toMatchObject({ home_action_id: r.target_id, action: 'not_now', item_key: KEY, state: h.action.before });
    expect(r.after).toMatchObject({ state: h.action.after });
    expect(r.summary).toBe(opSummary({ op: 'home_act', action: 'not_now', title: 'Grok rescan', until: h.state.view_at }, NOW));
    expect(r.undoable).toBe(true);
    expect(r.result).toEqual({ message: 'Back tomorrow at 9:00.', item_key: KEY });
  });
  it('a third Not now says it stays in view', async () => {
    h.state = { view_at: null };
    const r = await op.run(ctx() as any, op.validate({ action: 'not_now', item_key: KEY }), {});
    expect(r.summary).toBe('"Grok rescan" stays in view. Pick what to do with it.');
  });
  it('names a security item for not_emergency', async () => {
    h.db.task.findUnique.mockResolvedValue({ title: 'Wordfence alert', tags: ['security'] });
    const r = await op.run(ctx() as any, op.validate({ action: 'not_emergency', item_key: KEY }), {});
    expect(r.summary).toBe('"Wordfence alert" is a security item: taken out of Needs you now.');
  });
  it('is refused when the owner\'s home screen is off, and writes nothing', async () => {
    h.db.userPreference.findUnique.mockResolvedValue({ home_view: 'overlook' });
    await expect(op.run(ctx() as any, op.validate({ action: 'matters_more', item_key: KEY }), {})).rejects.toMatchObject({ statusCode: 409, message: 'Your home screen is off.' });
    expect(h.run).not.toHaveBeenCalled();
  });
  it('never taps (the worker does not read these rows), for every action, for Undo too', async () => {
    for (const body of [{ action: 'pin', item_key: KEY, switch: true }, { action: 'stop', item_key: KEY, note: null }, { action: 'swap', to_group_key: 'own' }, { action: 'lighter', to_group_key: 'own' }]) {
      const p = await op.prepare(ctx() as any, op.validate(body), 'chat');
      expect(p.reach.needs_tap).toBe(false);
    }
    const u = await op.prepareUndo(ctx() as any, { after: { home_action_id: 'a' } } as any);
    expect(u.reach.needs_tap).toBe(false);
  });
  it('Undo runs the screen\'s own undo for the owner, and lets its refusal through', async () => {
    h.undo.mockResolvedValue({ ok: true });
    const rec = { after: { home_action_id: 'abc' } } as any;
    expect(await op.undo(ctx() as any, rec, {})).toEqual({ ok: true });
    expect(h.undo).toHaveBeenCalledWith(h.db, OWNER, 'abc', NOW);
    h.undo.mockRejectedValue(Object.assign(new Error("Today's list changed since, so this can't be undone."), { statusCode: 409 }));
    await expect(op.undo(ctx() as any, rec, {})).rejects.toThrow("Today's list changed");
  });
});
