import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { POST as claim } from '../[id]/claim/route';
import { POST as sent } from '../[id]/sent/route';
import { POST as failed } from '../[id]/failed/route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailOutbox: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/sends/policy', () => ({ decideSend: vi.fn() }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { decideSend } from '@/lib/sends/policy';
import { AuthError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';

const box = prisma.emailOutbox as unknown as Record<'findMany' | 'findUnique' | 'updateMany' | 'update', Mock>;
const ctx = { params: Promise.resolve({ id: 'row-1' }) };
const req = (body?: unknown) =>
  new NextRequest('http://localhost:3000/api/email-outbox/row-1/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm' });
});

describe('GET /api/email-outbox', () => {
  it('lists unsent rows oldest first, limit 50', async () => {
    box.findMany.mockResolvedValue([{ id: 'row-1' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([{ id: 'row-1' }]);
    const arg = box.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ sent_at: null, superseded_at: null });
    expect(arg.orderBy).toEqual({ created_at: 'asc' });
    expect(arg.take).toBe(50);
    expect(arg.select.text).toBeUndefined();
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
  });

  it('401 without auth', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('no', 401));
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('POST claim', () => {
  it('claims an unclaimed row and returns it with its body', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue({ id: 'row-1', text: 'body', sent_at: null });
    const res = await claim(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('body');
    const where = box.updateMany.mock.calls[0][0].where;
    expect(where.sent_at).toBeNull();
    expect(where.OR[0]).toEqual({ claimed_at: null });
    expect(where.OR[1].claimed_at.lt).toBeInstanceOf(Date);
  });

  it('409 when claimed within the last 10 minutes', async () => {
    box.updateMany.mockResolvedValue({ count: 0 });
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null, claimed_at: new Date() });
    const res = await claim(req(), ctx);
    expect(res.status).toBe(409);
  });

  it('409 when already sent', async () => {
    box.updateMany.mockResolvedValue({ count: 0 });
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: new Date() });
    expect((await claim(req(), ctx)).status).toBe(409);
  });

  it('404 for a missing row', async () => {
    box.updateMany.mockResolvedValue({ count: 0 });
    box.findUnique.mockResolvedValue(null);
    expect((await claim(req(), ctx)).status).toBe(404);
  });

  // Fleet item 4: the send-time recheck.
  const T = '11111111-1111-4111-8111-111111111111';
  it('never claims a row that was already superseded', async () => {
    box.updateMany.mockResolvedValue({ count: 0 });
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null, superseded_at: new Date(), superseded_reason: 'already_approved' });
    const res = await claim(req(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'already_approved' });
    expect(box.updateMany.mock.calls[0][0].where.superseded_at).toBeNull();
  });

  it('a governed row the recheck drops is stamped superseded and answered 409 superseded', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue({ id: 'row-1', text: 'body', sent_at: null, govern: { intent: 'chat', task_id: T } });
    (decideSend as Mock).mockResolvedValue({ ok: false, reason: 'conversation_closed', severity: 'definitive', mode: 'enforce' });
    const res = await claim(req(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'conversation_closed' });
    expect(decideSend).toHaveBeenCalledWith({ intent: 'chat', task_id: T }, 'row-1');
    const data = box.update.mock.calls[0][0].data;
    expect(data.superseded_reason).toBe('conversation_closed');
    expect(data.superseded_at).toBeInstanceOf(Date);
  });

  it('a governed row that passes the recheck is returned', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue({ id: 'row-1', text: 'body', sent_at: null, govern: { intent: 'chat', task_id: T } });
    (decideSend as Mock).mockResolvedValue({ ok: true, mode: 'enforce' });
    expect((await claim(req(), ctx)).status).toBe(200);
  });

  it('a row without govern passes and the recheck is not run', async () => {
    box.updateMany.mockResolvedValue({ count: 1 });
    box.findUnique.mockResolvedValue({ id: 'row-1', text: 'body', sent_at: null, govern: null });
    expect((await claim(req(), ctx)).status).toBe(200);
    expect(decideSend).not.toHaveBeenCalled();
  });
});

describe('POST sent', () => {
  it('marks sent, stores the message id, scrubs the body', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null, message_id: null });
    box.update.mockResolvedValue({ sent_at: new Date('2026-10-21T20:00:00Z'), message_id: 'm1' });
    const res = await sent(req({ message_id: 'm1' }), ctx);
    expect(res.status).toBe(200);
    const data = box.update.mock.calls[0][0].data;
    expect(data.message_id).toBe('m1');
    expect(data.sent_at).toBeInstanceOf(Date);
    expect(data.html).toBeNull();
    expect(data.text).not.toContain('portal');
  });

  it('is idempotent for an already-sent row', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: new Date(), message_id: 'm1' });
    const res = await sent(req({ message_id: 'm2' }), ctx);
    expect(res.status).toBe(200);
    expect(box.update).not.toHaveBeenCalled();
  });

  it('404 for a missing row', async () => {
    box.findUnique.mockResolvedValue(null);
    expect((await sent(req({}), ctx)).status).toBe(404);
  });
});

describe('POST failed', () => {
  it('increments attempts, records the error, clears the claim', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null });
    box.update.mockResolvedValue({ attempts: 2, last_error: 'boom' });
    const res = await failed(req({ last_error: 'boom' }), ctx);
    expect(res.status).toBe(200);
    expect(box.update.mock.calls[0][0].data).toEqual({ last_error: 'boom', attempts: { increment: 1 }, claimed_at: null });
  });

  it('400 without last_error', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: null });
    expect((await failed(req({}), ctx)).status).toBe(400);
  });

  it('409 for an already-sent row', async () => {
    box.findUnique.mockResolvedValue({ id: 'row-1', sent_at: new Date() });
    expect((await failed(req({ last_error: 'x' }), ctx)).status).toBe(409);
  });
});
