/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { buildInbox, expireStaleMessages } from '../inbox';
import { EXPIRED_TEXT, STOP_CODE } from '../events';
import { makeChatDb, type FakeEvent } from './fake-db';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60 * 1000);
const SETTINGS = { id: 1, enabled: true, owner_user_id: 'o1111111-1111-4111-8111-111111111111', model: 'sonnet', effort: 'low', turn_budget_usd: 0.4, daily_turn_cap: 100, daily_write_cap: 25, daily_cost_cap_usd: 8, stale_after_minutes: 120, idle_close_minutes: 10 };

function seedMessage(db: ReturnType<typeof makeChatDb>, seq: number, minutesOld: number, over: Partial<FakeEvent> = {}) {
  db.events.push({ conversation_id: db.conv.id, seq, role: 'mike', kind: 'text', payload: { text: `m${seq}` }, context: { kind: 'task', id: '11111111-1111-4111-8111-111111111111', title: 'hidden' }, client_ref: `r${seq}`, delivered_at: null, expired_at: null, created_at: ago(minutesOld), ...over });
  db.conv.last_seq = Math.max(db.conv.last_seq, seq);
}

describe('expiry', () => {
  it('marks a waiting message older than the stale limit as expired, adds the notice, never deletes', async () => {
    const db = makeChatDb({ conv: { status: 'queued' }, settings: SETTINGS });
    seedMessage(db, 1, 121);
    seedMessage(db, 2, 119);
    const n = await expireStaleMessages(120, NOW, db);
    expect(n).toBe(1);
    expect(db.events.find((e: FakeEvent) => e.seq === 1)!.expired_at).toEqual(NOW);
    expect(db.events.find((e: FakeEvent) => e.seq === 2)!.expired_at).toBeNull();
    const notice = db.events.find((e: FakeEvent) => e.role === 'system')!;
    expect(notice.payload).toMatchObject({ code: 'expired', for_seq: 1, text: EXPIRED_TEXT });
    expect(notice.seq).toBe(3);
    expect(db.events.filter((e: FakeEvent) => e.role === 'mike')).toHaveLength(2);
    expect(db.bastChatEvent.updateMany.mock.calls.length).toBeGreaterThan(0);
    expect((db as any).bastChatEvent.delete).toBeUndefined();
  });
  it('the notice is plain: no dash, no banned word', () => {
    expect(EXPIRED_TEXT).not.toMatch(/[–—]/);
    expect(EXPIRED_TEXT.toLowerCase()).not.toMatch(/priority|overdue/);
  });
  it('puts the chat back to idle when nothing else is waiting', async () => {
    const db = makeChatDb({ conv: { status: 'queued' }, settings: SETTINGS });
    seedMessage(db, 1, 200);
    await expireStaleMessages(120, NOW, db);
    expect(db.conv.status).toBe('idle');
  });
  it('leaves a delivered message alone', async () => {
    const db = makeChatDb({ conv: { status: 'idle' }, settings: SETTINGS });
    seedMessage(db, 1, 500, { delivered_at: ago(400) });
    expect(await expireStaleMessages(120, NOW, db)).toBe(0);
  });
});

describe('buildInbox', () => {
  it('returns waiting messages with the card as kind and id only, plus settings in the machine shape', async () => {
    const db = makeChatDb({ conv: { status: 'queued' }, settings: SETTINGS });
    seedMessage(db, 1, 5);
    db.usage.turns = 4;
    const inbox = await buildInbox(NOW, db);
    expect(inbox.messages).toEqual([{ conversation_id: db.conv.id, seq: 1, client_ref: 'r1', text: 'm1', context: { kind: 'task', id: '11111111-1111-4111-8111-111111111111' } }]);
    expect(inbox.settings).toMatchObject({ enabled: true, owner_user_id: SETTINGS.owner_user_id, model: 'sonnet', effort: 'low', max_budget_usd: 0.4, max_turns: 10, idle_close_minutes: 10, turns_left: 96, writes_left: 25, usd_left: 8 });
    expect(inbox.stops).toEqual([]);
  });
  it('never returns an expired message', async () => {
    const db = makeChatDb({ conv: { status: 'queued' }, settings: SETTINGS });
    seedMessage(db, 1, 300);
    expect((await buildInbox(NOW, db)).messages).toEqual([]);
  });
  it('serves a stop once for a running chat', async () => {
    const db = makeChatDb({ conv: { status: 'running' }, settings: SETTINGS });
    db.events.push({ conversation_id: db.conv.id, seq: 1, role: 'system', kind: 'status', payload: { code: STOP_CODE }, delivered_at: null, expired_at: null, created_at: ago(1) });
    expect((await buildInbox(NOW, db)).stops).toEqual([{ conversation_id: db.conv.id }]);
    expect((await buildInbox(NOW, db)).stops).toEqual([]);
  });
  it('is empty when the chat is off or has no owner', async () => {
    const off = makeChatDb({ settings: { ...SETTINGS, enabled: false } });
    seedMessage(off, 1, 5);
    const r = await buildInbox(NOW, off);
    expect(r.messages).toEqual([]);
    expect(r.settings.enabled).toBe(false);
    const none = makeChatDb({ settings: null });
    expect((await buildInbox(NOW, none)).settings.enabled).toBe(false);
  });
});
