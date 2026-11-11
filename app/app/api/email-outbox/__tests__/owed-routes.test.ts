// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { POST as claim } from '../[id]/claim/route';
import { POST as sent } from '../[id]/sent/route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { emailOutbox: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/sends/policy', () => ({ decideSend: vi.fn() }));
vi.mock('@/lib/sends/owed-reply', async (orig) => {
  const actual = await orig<typeof import('@/lib/sends/owed-reply')>();
  return { ...actual, recheckOwedReply: vi.fn() };
});
vi.mock('@/lib/home/owed/rows', async (orig) => {
  const actual = await orig<typeof import('@/lib/home/owed/rows')>();
  return { ...actual, markOwedThreadSent: vi.fn().mockResolvedValue(undefined) };
});

import { requireAuth } from '@/lib/auth/middleware';
import { decideSend } from '@/lib/sends/policy';
import { recheckOwedReply } from '@/lib/sends/owed-reply';
import { markOwedThreadSent } from '@/lib/home/owed/rows';
import { prisma } from '@/lib/db/prisma';

const box = prisma.emailOutbox as unknown as Record<'findMany' | 'findUnique' | 'updateMany' | 'update', Mock>;
const ctx = { params: Promise.resolve({ id: 'row-1' }) };
const U = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const govern = { intent: 'owed_reply', home_action_id: H, user_id: U, ask_ids: [A], account: 'mike@x.test', thread_id: 't1', draft_id: 'd1' };
const past = new Date(Date.now() - 60_000);
const owedRow = (over: Record<string, unknown> = {}) => ({ id: 'row-1', kind: 'owed_reply', text: 'hi', sent_at: null, superseded_at: null, send_after: past, govern, ...over });
const post = (body?: unknown) => new NextRequest('http://localhost:3000/api/email-outbox/row-1/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const list = (qs = '') => GET(new NextRequest(`http://localhost:3000/api/email-outbox${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm' });
});

describe('GET /api/email-outbox: owed_reply rows', () => {
  it('the default listing never includes an owed_reply row', async () => {
    box.findMany.mockResolvedValue([{ id: 'a', kind: 'other' }, { id: 'b', kind: 'owed_reply' }]);
    const res = await list();
    expect((await res.json()).items.map((r: { id: string }) => r.id)).toEqual(['a']);
    expect(box.findMany.mock.calls[0][0].where).toEqual({ sent_at: null, superseded_at: null });
  });
  it('a full page that lost rows to the filter is asked again with the exclusion in the query', async () => {
    box.findMany
      .mockResolvedValueOnce([{ id: 'b', kind: 'owed_reply' }, ...Array.from({ length: 49 }, (_, i) => ({ id: `r${i}`, kind: 'other' }))])
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, kind: 'other' })));
    const res = await list();
    expect((await res.json()).items).toHaveLength(50);
    expect(box.findMany.mock.calls[1][0].where).toEqual({ sent_at: null, superseded_at: null, kind: { not: 'owed_reply' } });
  });
  it('?kind=owed_reply lists only due owed rows, with send_after', async () => {
    box.findMany.mockResolvedValue([{ id: 'b', kind: 'owed_reply' }]);
    const res = await list('?kind=owed_reply');
    expect((await res.json()).items).toHaveLength(1);
    const arg = box.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ sent_at: null, superseded_at: null, kind: 'owed_reply' });
    expect(arg.where.send_after.lte).toBeInstanceOf(Date);
    expect(arg.select.send_after).toBe(true);
    expect(arg.select.text).toBeUndefined();
  });
  it('any other kind value is a 400', async () => {
    expect((await list('?kind=other')).status).toBe(400);
    expect(box.findMany).not.toHaveBeenCalled();
  });
});

describe('POST claim: the hold and the owed checks', () => {
  it('every claim carries the hold condition; a null send_after is not held', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue({ id: 'row-1', text: 'body', sent_at: null, kind: 'other', send_after: null });
    expect((await claim(post(), ctx)).status).toBe(200);
    const where = box.updateMany.mock.calls[0][0].where;
    expect(where.AND[0].OR[0]).toEqual({ send_after: null });
    expect(where.AND[0].OR[1].send_after.lte).toBeInstanceOf(Date);
    expect(recheckOwedReply).not.toHaveBeenCalled();
  });
  it('a held row is refused 409 held and left untouched', async () => {
    box.updateMany.mockResolvedValue({ count: 0 });
    box.findUnique.mockResolvedValue(owedRow({ send_after: new Date(Date.now() + 600_000) }));
    const res = await claim(post(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'held' });
    expect(box.update).not.toHaveBeenCalled();
  });
  it('no press: 409, and the row is stamped superseded for good', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue(owedRow());
    (recheckOwedReply as Mock).mockResolvedValue({ ok: false, reason: 'no_press' });
    const res = await claim(post(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'no_press' });
    expect(box.update.mock.calls[0][0].data.superseded_reason).toBe('no_press');
    expect(decideSend).not.toHaveBeenCalled();
  });
  it('switch off: 409 send_off, the claim is given back, the row is not superseded', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue(owedRow());
    (recheckOwedReply as Mock).mockResolvedValue({ ok: false, reason: 'send_off' });
    const res = await claim(post(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'send_off' });
    expect(box.update.mock.calls[0][0].data).toEqual({ claimed_at: null });
  });
  it('an owed row is checked even when send_recheck_mode would be off: decideSend is never the gate', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue(owedRow());
    (recheckOwedReply as Mock).mockResolvedValue({ ok: true });
    (decideSend as Mock).mockResolvedValue({ ok: true, mode: 'off' });
    expect((await claim(post(), ctx)).status).toBe(200);
    expect(recheckOwedReply).toHaveBeenCalledTimes(1);
  });
  it('a row of kind owed_reply with no govern block is checked and refused (no_press)', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue(owedRow({ govern: null }));
    (recheckOwedReply as Mock).mockResolvedValue({ ok: false, reason: 'no_press' });
    expect((await claim(post(), ctx)).status).toBe(409);
    expect((recheckOwedReply as Mock).mock.calls[0][0]).toBeNull();
  });
});

describe('POST sent', () => {
  it('an owed_reply row marks the thread\'s owed row sent', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null, message_id: null, kind: 'owed_reply', task_id: null, govern });
    box.update.mockResolvedValue({ sent_at: new Date(), message_id: 'm1' });
    const res = await sent(post({ message_id: 'm1', gmail_thread_id: 't1' }), ctx);
    expect(res.status).toBe(200);
    expect(markOwedThreadSent).toHaveBeenCalledWith(prisma, U, 'thread:mike@x.test:t1');
  });
  it('another kind does not', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null, message_id: null, kind: 'other', task_id: null, govern: null });
    box.update.mockResolvedValue({ sent_at: new Date(), message_id: 'm1' });
    expect((await sent(post({ message_id: 'm1' }), ctx)).status).toBe(200);
    expect(markOwedThreadSent).not.toHaveBeenCalled();
  });
});
