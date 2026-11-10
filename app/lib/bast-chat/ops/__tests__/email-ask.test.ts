/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));

import { getRunnableOp } from '..';

const ASK = '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d';
const NOW = new Date('2026-11-10T15:00:00Z');
const op = getRunnableOp('email_ask')!;
const ctx = () => ({ db: h.db, ownerId: 'o', now: NOW });
let ask: any;

beforeEach(() => {
  ask = { id: ASK, state: 'open', subject: 'Re: footer links', draft_started_at: new Date('2026-11-09T10:00:00Z'), draft_url: 'https://mail.google.com/mail/#drafts/abc' };
  h.db = {
    emailAsk: {
      findUnique: vi.fn(async () => (ask ? { ...ask } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => { if (ask.id !== where.id || (where.state && ask.state !== where.state)) return { count: 0 }; Object.assign(ask, data); return { count: 1 }; }),
    },
  };
});

describe('email_ask op', () => {
  it('is strict and knows three states', () => {
    expect(() => op.validate({ ask_id: ASK, state: 'archive_requested' })).toThrow();
    expect(() => op.validate({ ask_id: ASK, state: 'handled', task_id: ASK })).toThrow();
    expect(op.validate({ ask_id: ASK, state: 'dismissed' })).toEqual({ ask_id: ASK, state: 'dismissed' });
  });
  it('handled clears the draft marker, records both sides, and Undo restores open plus the marker', async () => {
    const input = op.validate({ ask_id: ASK, state: 'handled' });
    const p = await op.prepare(ctx() as any, input, 'chat');
    expect(p.reach.needs_tap).toBe(false);
    const r = await op.run(ctx() as any, input, p.expect);
    expect(ask).toMatchObject({ state: 'handled', draft_started_at: null, draft_url: null });
    expect(r.before).toEqual({ ask_id: ASK, state: 'open', draft_started_at: '2026-11-09T10:00:00.000Z', draft_url: 'https://mail.google.com/mail/#drafts/abc' });
    expect(r.after).toEqual({ ask_id: ASK, state: 'handled', draft_started_at: null, draft_url: null });
    expect(r.summary).toBe('"Re: footer links": marked handled.');
    const rec = { before: r.before, after: r.after } as any;
    const u = await op.prepareUndo(ctx() as any, rec);
    expect(await op.undo(ctx() as any, rec, u.expect)).toEqual({ ok: true });
    expect(ask).toMatchObject({ state: 'open', draft_started_at: new Date('2026-11-09T10:00:00Z'), draft_url: 'https://mail.google.com/mail/#drafts/abc' });
  });
  it('no reply needed says so; reopen puts it back to open', async () => {
    const r = await op.run(ctx() as any, op.validate({ ask_id: ASK, state: 'dismissed' }), { state: 'open' });
    expect(r.summary).toBe('"Re: footer links": marked no reply needed.');
    ask.draft_url = null;
    const r2 = await op.run(ctx() as any, op.validate({ ask_id: ASK, state: 'open' }), { state: 'dismissed' });
    expect(r2.summary).toBe('"Re: footer links": open again.');
    expect(ask.state).toBe('open');
  });
  it('refuses an ask already filed another way, a no-change, and a stale write', async () => {
    ask.state = 'archive_requested';
    await expect(op.prepare(ctx() as any, op.validate({ ask_id: ASK, state: 'handled' }), 'chat')).rejects.toMatchObject({ statusCode: 409 });
    ask.state = 'handled';
    await expect(op.prepare(ctx() as any, op.validate({ ask_id: ASK, state: 'handled' }), 'chat')).rejects.toMatchObject({ statusCode: 409 });
    ask.state = 'dismissed';
    await expect(op.run(ctx() as any, op.validate({ ask_id: ASK, state: 'handled' }), { state: 'open' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('Undo refuses when the state moved on', async () => {
    const r = await op.run(ctx() as any, op.validate({ ask_id: ASK, state: 'handled' }), { state: 'open' });
    ask.state = 'open';
    await expect(op.prepareUndo(ctx() as any, { before: r.before, after: r.after } as any)).rejects.toMatchObject({ statusCode: 409 });
  });
});
