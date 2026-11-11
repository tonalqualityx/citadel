import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { selectHome } from '../select';
import { actionsFor } from '../actions-for';
import { homeActSchema, runHomeUndo } from '../act';
import { threadKey } from '../item-key';
import { NOW, d, makeClient, makeInputs, makeThread } from './fixtures/tonight';
import { makeRow } from '../owed/__tests__/fixtures/owed-row';
import { notSentLine, sendFailureReason, sendingLine, sentLine, SEND_COPY } from '../owed/send-copy';
import type { RawHomeInputs, RawOwedSend } from '../types';

const client = makeClient('Active Co');
const sel = (raw: Partial<RawHomeInputs>) => selectHome({ raw: makeInputs({ now: NOW, ...raw }), states: [], now: NOW });
const t = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
const key = threadKey(t.account, t.thread_id);
const drafted = makeRow({ thread_key: key, state: 'drafted', draft_id: 'g1', draft_for_ask_id: t.asks[0].id, draft_text: 'Thanks, got this. I will get back to you.' });
const ids = (r: ReturnType<typeof sel>) => {
  const item = r.candidates.find((c) => c.key === key)!.item;
  return { shown: item.actions.map((a) => a.id), more: item.more_actions.map((a) => a.id), item };
};
const press = (over: Partial<RawOwedSend> = {}): RawOwedSend => ({
  action_id: 'act-1', item_key: key, who: 'Dana', send_after: new Date(NOW.getTime() + 5 * 60_000), pressed_at: new Date(NOW.getTime() - 5 * 60_000), status: 'pending', reason: null, ...over,
});

describe('Slice 4b: with the switch off (the shipped state) there is no Send anywhere', () => {
  it('no raw.owed_send: no Send button, no owed_send on the item', () => {
    const r = ids(sel({ threads: [t], owed_rows: [drafted] }));
    expect([...r.shown, ...r.more].join(' ')).not.toMatch(/send/);
    expect(r.item.owed_send ?? null).toBeNull();
    expect(r.shown[0]).toBe('open_draft');
  });
  it('owed_send false: the same', () => {
    const r = ids(sel({ threads: [t], owed_rows: [drafted], owed_send: false }));
    expect([...r.shown, ...r.more].join(' ')).not.toMatch(/send/);
  });
  it('actionsFor never makes a Send button without the send flag', () => {
    const out = actionsFor({ kind: 'thread', emergency: false, pinned: false, parkCount: 0, filledFirst: false, draftUrl: 'https://x', threadUrl: 'https://y', owedThread: { state: 'draft_ready', suggestion: false, short: true } });
    expect([...out.actions, ...out.more_actions].map((a) => a.id).join(' ')).not.toMatch(/send/);
  });
});

describe('Slice 4b: with the switch on', () => {
  it('Send the draft is the first button on a row whose draft is Bast\'s and ready', () => {
    const r = ids(sel({ threads: [t], owed_rows: [drafted], owed_send: true }));
    expect(r.shown[0]).toBe('send_draft');
    expect(r.item.owed_send).toEqual({ draft_id: 'g1', short_draft_id: null });
    expect(r.shown).toContain('not_now');
    expect(r.item.actions[0].label).toBe('Send the draft');
  });
  it('not on a stale draft, a needs-thought row, his edited draft, a draft with a blank, or a pending request', () => {
    const cases = [
      { ...drafted, draft_for_ask_id: 'older-ask' },
      { ...drafted, state: 'needs_thought', bast_read: 'x' },
      { ...drafted, mike_edited_at: d('2026-11-04T15:00:00Z') },
      { ...drafted, draft_text: 'Dear [[name]], hello.' },
      { ...drafted, request_kind: 'read', requested_at: NOW },
    ];
    for (const row of cases) {
      const r = ids(sel({ threads: [t], owed_rows: [row], owed_send: true }));
      expect([...r.shown, ...r.more].join(' ')).not.toMatch(/send_draft/);
      expect(r.item.owed_send ?? null).toBeNull();
    }
  });
  it('the short one follows the same door: Send the short one under More, with its own id', () => {
    const row = { ...drafted, short_draft_id: 's1', short_draft_text: 'Short.' };
    const r = ids(sel({ threads: [t], owed_rows: [row], owed_send: true }));
    expect(r.shown[0]).toBe('send_draft');
    expect(r.more).toContain('send_short');
    expect(r.item.owed_send).toEqual({ draft_id: 'g1', short_draft_id: 's1' });
  });
  it('a short draft on a needs-thought row can be sent, and the full Send is absent', () => {
    const row = { ...drafted, state: 'needs_thought', bast_read: 'x', short_draft_id: 's1', short_draft_text: 'Short.' };
    const r = ids(sel({ threads: [t], owed_rows: [row], owed_send: true }));
    expect(r.more).toContain('send_short');
    expect([...r.shown, ...r.more]).not.toContain('send_draft');
    expect(r.item.owed_send).toEqual({ draft_id: null, short_draft_id: 's1' });
  });
});

describe('Slice 4b: the row leaves People and Handled for you tells it', () => {
  const rows = (status: RawOwedSend['status'], reason: string | null = null) => sel({ threads: [t], owed_rows: [drafted], owed_send: true, owed_sends: [press({ status, reason })] });
  it('while sending: the row is gone and the line has Undo', () => {
    const r = rows('pending');
    expect(r.candidates.find((c) => c.key === key)).toBeUndefined();
    expect(r.sections.handled[0].text).toBe(sendingLine('Dana', press().send_after, 'America/New_York'));
    expect(r.sections.handled[0].text).toMatch(/^Sending your reply to Dana at \d{1,2}:\d{2} (AM|PM)\.$/);
    expect(r.sections.handled[0].undo_action_id).toBe('act-1');
  });
  it('after the hold the Undo is gone even before the send lands', () => {
    const r = sel({ threads: [t], owed_rows: [drafted], owed_send: true, owed_sends: [press({ send_after: new Date(NOW.getTime() - 1000) })] });
    expect(r.sections.handled[0].undo_action_id).toBeNull();
  });
  it('sent: "Sent your reply to Dana." and no Undo', () => {
    const r = rows('sent');
    expect(r.candidates.find((c) => c.key === key)).toBeUndefined();
    expect(r.sections.handled[0].text).toBe(sentLine('Dana'));
    expect(r.sections.handled[0].undo_action_id).toBeNull();
  });
  it('not sent: the row comes back, with the reason in plain words', () => {
    const r = rows('failed', 'already_replied');
    expect(r.candidates.find((c) => c.key === key)).toBeDefined();
    expect(r.sections.handled[0].text).toBe('Not sent: the thread already has a reply. The draft is still in your Gmail.');
    expect(r.sections.handled[0].undo_action_id).toBeNull();
  });
  it('the words have no dash and none of the banned words', () => {
    const all = [SEND_COPY.off, SEND_COPY.notCurrent, SEND_COPY.alreadyQueued, SEND_COPY.noThread, SEND_COPY.blank, SEND_COPY.tooLate, SEND_COPY.chatUndo, sentLine('Dana'), notSentLine(sendFailureReason('draft has a blank')), sendingLine('Dana', NOW, 'America/New_York')];
    for (const s of all) expect(s).not.toMatch(/[\u2013\u2014]|priorit|overdue/i);
    expect(sendFailureReason('draft has a blank')).toBe('the draft still has a blank to fill in');
    expect(sendFailureReason(null)).toBe('it could not be sent');
  });
});

describe('Slice 4b: the chat cannot send or undo a send', () => {
  it('homeActSchema refuses send_draft and send_short', () => {
    expect(homeActSchema.safeParse({ action: 'send_draft', item_key: 'thread:a:b' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'send_short', item_key: 'thread:a:b' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'send_draft', item_key: 'thread:a:b', draft_id: 'x' }).success).toBe(false);
  });
  it('runHomeUndo refuses a send_draft row for every caller, writing nothing', async () => {
    const row = { id: 'r1', item_key: key, action: 'send_draft', source: 'home', before: null, after: { outbox_id: 'o1' }, undo_until: new Date(NOW.getTime() + 60_000), undone_at: null, created_at: NOW };
    const markUndone = vi.fn();
    const db: Record<string, unknown> = { homeAction: { findFirst: vi.fn().mockResolvedValue(row), updateMany: markUndone }, emailOutbox: { updateMany: vi.fn() } };
    db.$transaction = (fn: (tx: unknown) => unknown) => fn(db);
    await expect(runHomeUndo(db as unknown as PrismaClient, 'u', 'r1', NOW)).rejects.toMatchObject({ code: 'not_undoable', statusCode: 409, message: 'Undo that on the home screen.' });
    expect(markUndone).not.toHaveBeenCalled();
    expect((db.emailOutbox as { updateMany: ReturnType<typeof vi.fn> }).updateMany).not.toHaveBeenCalled();
  });
});
