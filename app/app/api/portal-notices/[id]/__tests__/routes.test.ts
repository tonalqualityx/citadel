import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({
  prisma: { portalNotice: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock('@/lib/portal/notices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/notices')>();
  return { ...actual, cancelStaleNotices: vi.fn(async () => 0), claimNotice: vi.fn() };
});

import { PUT as sending } from '../sending/route';
import { PUT as sent } from '../sent/route';
import { PUT as sendError } from '../send-error/route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { claimNotice } from '@/lib/portal/notices';

const n = prisma.portalNotice as unknown as Record<string, Mock>;
const ctx = { params: Promise.resolve({ id: 'n1' }) };
const put = (fn: typeof sending, body: unknown = {}) =>
  fn(new NextRequest(new URL('http://localhost/api/portal-notices/n1/x'), { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'oracle', role: 'pm' });
});

describe('PUT /api/portal-notices/:id/sending (the claim)', () => {
  it('claims and answers with the notice as it stands now: to_email, subject and body', async () => {
    (claimNotice as Mock).mockResolvedValue({
      ok: true,
      notice: { id: 'n1', status: 'sending', send_attempt_at: new Date('2026-10-21T12:00:00Z'), to_email: 'dana@x.com', subject: 'New reply on your request: T', body: 'fresh body' },
    });
    const res = await put(sending);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'n1', status: 'sending', to_email: 'dana@x.com', subject: 'New reply on your request: T', body: 'fresh body' });
  });
  it('409s with a reason when the replies were withdrawn, the recipient lost access, or it is not queued', async () => {
    for (const reason of ['withdrawn', 'no_access', 'not_queued']) {
      (claimNotice as Mock).mockResolvedValue({ ok: false, reason });
      const res = await put(sending);
      expect(res.status, reason).toBe(409);
      expect((await res.json()).code).toBe(reason);
    }
  });
  it('404s an unknown notice and 403s a tech user', async () => {
    (claimNotice as Mock).mockResolvedValue({ ok: false, reason: 'not_found' });
    expect((await put(sending)).status).toBe(404);
    (requireAuth as Mock).mockResolvedValue({ userId: 'u', role: 'tech' });
    expect((await put(sending)).status).toBe(403);
  });
});

describe('PUT /api/portal-notices/:id/sent', () => {
  const ok = { sent_at: '2026-10-21T12:00:00.000Z', message_id: 'm', thread_id: 't' };
  it('records a delivery from sending', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending' });
    n.update.mockResolvedValue({ id: 'n1', status: 'sent', message_id: 'm', thread_id: 't', sent_at: new Date(ok.sent_at), send_error: null });
    expect((await put(sent, ok)).status).toBe(200);
    expect(n.update.mock.calls[0][0].data).toMatchObject({ status: 'sent', message_id: 'm', thread_id: 't', send_error: null, send_error_count: 0 });
  });
  it('an already sent notice is an idempotent re-confirmation', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sent', message_id: 'm', thread_id: 't', sent_at: new Date() });
    const res = await put(sent, ok);
    expect(res.status).toBe(200);
    expect(n.update).not.toHaveBeenCalled();
  });
  it('delivered_unconfirmed records without ids and marks the row', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending' });
    n.update.mockResolvedValue({ id: 'n1', status: 'sent', send_error: 'message id unresolved' });
    expect((await put(sent, { sent_at: ok.sent_at, delivered_unconfirmed: true })).status).toBe(200);
    expect(n.update.mock.calls[0][0].data.send_error).toBe('message id unresolved');
  });
  it('requires ids unless unconfirmed, and 409s from other states', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending' });
    expect((await put(sent, { sent_at: ok.sent_at })).status).toBe(400);
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'queued' });
    expect((await put(sent, ok)).status).toBe(409);
  });
});

describe('PUT /api/portal-notices/:id/send-error (three strikes to failed)', () => {
  it('the first two errors release the notice back to queued', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending', send_error_count: 1 });
    n.update.mockResolvedValue({ id: 'n1', status: 'queued', send_error: 'boom', send_error_count: 2 });
    await put(sendError, { error: 'boom' });
    expect(n.update.mock.calls[0][0].data).toMatchObject({ status: 'queued', send_attempt_at: null, send_error_count: 2 });
  });
  it('the third error ends in failed', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending', send_error_count: 2 });
    n.update.mockResolvedValue({ id: 'n1', status: 'failed', send_error: 'boom', send_error_count: 3 });
    await put(sendError, { error: 'boom' });
    expect(n.update.mock.calls[0][0].data.status).toBe('failed');
  });
  it('a refusal on a queued notice (the sender local ledger) goes straight to failed', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'queued', send_error_count: 0 });
    n.update.mockResolvedValue({ id: 'n1', status: 'failed', send_error: 'x', send_error_count: 1 });
    await put(sendError, { error: 'refused: already sent once from this machine' });
    expect(n.update.mock.calls[0][0].data.status).toBe('failed');
  });
  it('409s from sent or cancelled, 400s an empty error', async () => {
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sent', send_error_count: 0 });
    expect((await put(sendError, { error: 'x' })).status).toBe(409);
    n.findUnique.mockResolvedValue({ id: 'n1', status: 'sending', send_error_count: 0 });
    expect((await put(sendError, { error: '' })).status).toBe(400);
  });
});
