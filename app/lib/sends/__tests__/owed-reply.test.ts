// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { parseGovern } from '../govern';
import { owedSwitchOn, recheckOwedReply, owedThreadKey, OWED_HOLD_MS } from '../owed-reply';
import { queueInOutbox } from '../outbox';

const U = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-12T15:00:00Z');
const G = { intent: 'owed_reply' as const, home_action_id: H, user_id: U, ask_ids: [A], account: 'mike@x.test', thread_id: 't1', draft_id: 'd1' };

function fakeDb(over: { settings?: unknown; user?: unknown; pref?: unknown; action?: unknown; open?: number } = {}) {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(over, k);
  return {
    homeKeeperSettings: { findUnique: vi.fn().mockResolvedValue(has('settings') ? over.settings : { owed_send: true }) },
    user: { findUnique: vi.fn().mockResolvedValue(has('user') ? over.user : { role: 'admin', is_active: true }) },
    userPreference: { findUnique: vi.fn().mockResolvedValue(has('pref') ? over.pref : { home_view: 'home' }) },
    homeAction: {
      findUnique: vi.fn().mockResolvedValue(
        has('action') ? over.action : { action: 'send_draft', source: 'home', user_id: U, undone_at: null, item_key: owedThreadKey(G), after: { draft_id: 'd1' } },
      ),
    },
    emailAsk: { count: vi.fn().mockResolvedValue(over.open ?? 1) },
    emailOutbox: { create: vi.fn().mockResolvedValue({ id: 'row-1' }) },
  };
}
const due = { kind: 'owed_reply', send_after: new Date(NOW.getTime() - 1000) };
const run = (db: ReturnType<typeof fakeDb>, row: unknown = due, g: unknown = G) => recheckOwedReply(g as never, row as never, NOW, db as never);

describe('parseGovern owed_reply', () => {
  it('accepts the full block and refuses a partial one', () => {
    expect(parseGovern(G)).toEqual(G);
    for (const bad of [{ ...G, ask_ids: [] }, { ...G, ask_ids: ['x'] }, { ...G, home_action_id: 'x' }, { ...G, user_id: undefined }, { ...G, draft_id: '' }, { ...G, thread_id: 3 }]) {
      expect(parseGovern(bad)).toBeNull();
    }
  });
});

describe('owedSwitchOn: no settings row means off', () => {
  it('is off with no row, with owed_send false, for a non-admin, an inactive user and with the home screen off', async () => {
    expect(await owedSwitchOn(fakeDb({ settings: null }) as never, U)).toBe(false);
    expect(await owedSwitchOn(fakeDb({ settings: { owed_send: false } }) as never, U)).toBe(false);
    expect(await owedSwitchOn(fakeDb({ user: { role: 'pm', is_active: true } }) as never, U)).toBe(false);
    expect(await owedSwitchOn(fakeDb({ user: { role: 'admin', is_active: false } }) as never, U)).toBe(false);
    expect(await owedSwitchOn(fakeDb({ pref: { home_view: 'classic' } }) as never, U)).toBe(false);
    expect(await owedSwitchOn(fakeDb() as never, U)).toBe(true);
  });
});

describe('recheckOwedReply, in order', () => {
  it('passes only the whole chain', async () => {
    expect(await run(fakeDb())).toEqual({ ok: true });
  });
  it('no govern block, or another intent, is no_press', async () => {
    expect(await run(fakeDb(), due, null)).toEqual({ ok: false, reason: 'no_press' });
    expect(await run(fakeDb(), due, { intent: 'none', reason: 'x' })).toEqual({ ok: false, reason: 'no_press' });
  });
  it('a row of another kind is no_press', async () => {
    expect(await run(fakeDb(), { kind: 'other', send_after: due.send_after })).toEqual({ ok: false, reason: 'no_press' });
  });
  it('switch off is send_off before anything else, and reads no press', async () => {
    const db = fakeDb({ settings: null });
    expect(await run(db)).toEqual({ ok: false, reason: 'send_off' });
    expect(db.homeAction.findUnique).not.toHaveBeenCalled();
  });
  it('a missing press, another user\'s press, another thread or another draft is no_press', async () => {
    const act = { action: 'send_draft', source: 'home', user_id: U, undone_at: null, item_key: owedThreadKey(G), after: { draft_id: 'd1' } };
    for (const action of [null, { ...act, action: 'not_now' }, { ...act, source: 'keeper' }, { ...act, user_id: A }, { ...act, item_key: 'thread:a:b' }, { ...act, after: { draft_id: 'd2' } }, { ...act, after: null }]) {
      expect(await run(fakeDb({ action }))).toEqual({ ok: false, reason: 'no_press' });
    }
  });
  it('an undone press is superseded', async () => {
    const action = { action: 'send_draft', source: 'home', user_id: U, undone_at: NOW, item_key: owedThreadKey(G), after: { draft_id: 'd1' } };
    expect(await run(fakeDb({ action }))).toEqual({ ok: false, reason: 'superseded' });
  });
  it('a row with no send_after is no_press; before it is held; long after it is expired', async () => {
    expect(await run(fakeDb(), { kind: 'owed_reply', send_after: null })).toEqual({ ok: false, reason: 'no_press' });
    expect(await run(fakeDb(), { kind: 'owed_reply', send_after: new Date(NOW.getTime() + OWED_HOLD_MS) })).toEqual({ ok: false, reason: 'held' });
    expect(await run(fakeDb(), { kind: 'owed_reply', send_after: new Date(NOW.getTime() - 7 * 3600_000) })).toEqual({ ok: false, reason: 'expired' });
  });
  it('a mail that is no longer open is already_replied', async () => {
    expect(await run(fakeDb({ open: 0 }))).toEqual({ ok: false, reason: 'already_replied' });
  });
});

describe('queueInOutbox refuses an owed_reply row it should not make', () => {
  const input = { to: 'a@b.test', subject: 'Re: x', text: 'hi', kind: 'owed_reply', send_after: new Date(Date.now() + OWED_HOLD_MS) };
  it('with no settings row, nothing is created', async () => {
    const db = fakeDb({ settings: null });
    await expect(queueInOutbox(db as never, input, G)).rejects.toThrow('send_off');
    expect(db.emailOutbox.create).not.toHaveBeenCalled();
  });
  it('with the switch on it is created with its hold', async () => {
    const db = fakeDb();
    await queueInOutbox(db as never, input, G);
    expect((db.emailOutbox.create as Mock).mock.calls[0][0].data.send_after).toBeInstanceOf(Date);
  });
  it('the kind and the govern block must agree, and a hold must lie ahead', async () => {
    const db = fakeDb();
    await expect(queueInOutbox(db as never, { ...input, kind: 'other' }, G)).rejects.toThrow();
    await expect(queueInOutbox(db as never, input, { intent: 'none', reason: 'x' })).rejects.toThrow();
    await expect(queueInOutbox(db as never, { ...input, send_after: null }, G)).rejects.toThrow();
    await expect(queueInOutbox(db as never, { ...input, send_after: new Date(Date.now() - 1000) }, G)).rejects.toThrow();
    expect(db.emailOutbox.create).not.toHaveBeenCalled();
  });
  it('other kinds are untouched: no settings read, no hold', async () => {
    const db = fakeDb();
    await queueInOutbox(db as never, { to: 'a@b.test', subject: 's', text: 't' }, { intent: 'none', reason: 'x' });
    expect(db.homeKeeperSettings.findUnique).not.toHaveBeenCalled();
    expect((db.emailOutbox.create as Mock).mock.calls[0][0].data.send_after).toBeNull();
  });
});
