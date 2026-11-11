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
const ensure = vi.hoisted(() => vi.fn(async () => '2026-11-10'));
vi.mock('@/lib/home/ensure-day', () => ({ ensureHomeDay: ensure }));
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
  it('V4: stores today\'s day row before the act runs, for the owner in the owner\'s zone', async () => {
    const order: string[] = [];
    ensure.mockImplementation(async () => { order.push('ensure'); return '2026-11-10'; });
    h.run.mockImplementation(async () => { order.push('act'); return { ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: KEY, message: null }; });
    await op.run(ctx() as any, op.validate({ action: 'lighter', to_group_key: 'own' }), {});
    expect(order).toEqual(['ensure', 'act']);
    expect(ensure).toHaveBeenCalledWith(h.db, OWNER, NOW, 'America/New_York');
  });
  it('V4: a screen that is off stores nothing', async () => {
    h.db.userPreference.findUnique.mockResolvedValue({ home_view: 'overlook' });
    await expect(op.run(ctx() as any, op.validate({ action: 'lighter', to_group_key: 'own' }), {})).rejects.toMatchObject({ statusCode: 409 });
    expect(ensure).not.toHaveBeenCalled();
  });
  it('a third Not now says it stays in view', async () => {
    h.state = { view_at: null };
    const r = await op.run(ctx() as any, op.validate({ action: 'not_now', item_key: KEY }), {});
    expect(r.summary).toBe('"Grok rescan" stays in view. Pick what to do with it.');
  });
  it('bring_forward passes through runHomeAct and says it moved to the front of Next', async () => {
    h.run.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: KEY, message: 'Moved to the front of Next.' });
    const input = op.validate({ action: 'bring_forward', item_key: KEY });
    const r = await op.run(ctx() as any, input, {});
    expect(h.run.mock.calls[0][2]).toEqual({ action: 'bring_forward', item_key: KEY });
    expect(r.summary).toBe('"Grok rescan" moved to the front of Next.');
    expect(r.undoable).toBe(true);
    expect(() => op.validate({ action: 'bring_forward', item_key: KEY, user_id: 'x' })).toThrow();
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

describe('home op: Slice 4a owed reply taps', () => {
  const THREAD = 'thread:mike@becomeindelible.com:th-1';
  beforeEach(() => {
    h.db.emailAsk = { findFirst: vi.fn(async () => ({ from_name: 'Jessica Everlith', from_email: 'jess@x.example' })) };
  });
  it('validates the three actions with the strict schema and refuses a send action', () => {
    for (const action of ['draft_now', 'needs_thought', 'go_with_that']) expect(op.validate({ action, item_key: THREAD })).toEqual({ action, item_key: THREAD });
    expect(() => op.validate({ action: 'send_draft', item_key: THREAD })).toThrow();
    expect(() => op.validate({ action: 'draft_now', item_key: THREAD, user_id: 'x' })).toThrow();
  });
  it('says what Bast will do, naming the person from the record', async () => {
    const lines: Record<string, string> = {
      draft_now: 'Bast will draft a reply to Jessica Everlith.',
      needs_thought: "Bast will write its read on Jessica Everlith's thread.",
      go_with_that: "Bast will redraft Jessica Everlith's reply along its suggestion.",
    };
    for (const [action, line] of Object.entries(lines)) {
      h.run.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: THREAD, message: 'x' });
      const r = await op.run(ctx() as any, op.validate({ action, item_key: THREAD }), {});
      expect(h.run.mock.calls.at(-1)![2]).toEqual({ action, item_key: THREAD });
      expect(r.summary).toBe(line);
      expect(r.summary).not.toMatch(/[\u2013\u2014]|priorit|overdue|send/i);
    }
  });
});

describe('home op: Slice 6a', () => {
  it('not_this_week is allowed and says what it did; the chat has no action that saves a rule', async () => {
    expect(op.validate({ action: 'not_this_week', item_key: 'hands:week' })).toEqual({ action: 'not_this_week', item_key: 'hands:week' });
    for (const action of ['not_emergency_rule', 'save_rule', 'rule']) expect(() => op.validate({ action, item_key: 'crisis:11111111-1111-4111-8111-111111111111', scope: 'sender' })).toThrow();
    expect(() => op.validate({ action: 'not_emergency', item_key: 'crisis:11111111-1111-4111-8111-111111111111', scope: 'sender' })).toThrow();
    h.run.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: 'hands:week', message: 'Back next Monday.' });
    const r = await op.run(ctx() as any, op.validate({ action: 'not_this_week', item_key: 'hands:week' }), {});
    expect(r.summary).toBe("This week's hands row is parked until next Monday.");
    expect(r.summary).not.toMatch(/[\u2013\u2014]|priorit|overdue/i);
  });
  it('Undo of a saved rule is refused by the screen\'s own undo, so a chat undo can never retract or restore a rule', async () => {
    h.undo.mockRejectedValue(Object.assign(new Error('A saved rule is removed from its own line under Handled for you.'), { statusCode: 409 }));
    await expect(op.undo(ctx() as any, { after: { home_action_id: 'abc' } } as any, {})).rejects.toThrow('A saved rule is removed');
  });
});

describe('home op: Slice 8b', () => {
  const P = '99999999-9999-4999-8999-999999999999';
  it('step_done marks only: it says so, reads the project name from the record, and the op never touches the refresh route', async () => {
    h.db.project = { findUnique: vi.fn(async () => ({ name: 'Jack Gaughan Artist Site' })) };
    const input = op.validate({ action: 'step_done', item_key: `step:${P}` });
    expect(input).toEqual({ action: 'step_done', item_key: `step:${P}` });
    expect(() => op.validate({ action: 'step_done', item_key: `step:${P}`, step_done_text: 'x' })).toThrow();
    h.run.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: `step:${P}`, message: 'Bast will read the project again in a few minutes.' });
    const r = await op.run(ctx() as any, input, {});
    expect(r.summary).toBe('Marked the Jack Gaughan Artist Site step as done.');
    expect(r.summary).not.toMatch(/[\u2013\u2014]|priorit|overdue/i);
    expect(h.db.project.findUnique).toHaveBeenCalledWith({ where: { id: P }, select: { name: true } });
  });
});
