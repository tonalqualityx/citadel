import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
    clientInvoice: { upsert: vi.fn(), updateMany: vi.fn() },
  },
}));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const ctx = { params: Promise.resolve({ id: 'client-1' }) };
const inv = {
  qbo_invoice_id: '101', doc_number: '3371', txn_date: '2026-09-01', due_date: '2026-09-16',
  total: 850, balance: 850, status: 'overdue', pay_link: 'https://connect.intuit.com/pay/x',
};
function req(body: unknown) {
  return new NextRequest(new URL('http://localhost/api/clients/client-1/invoices/sync'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm' });
  (prisma.client.findFirst as Mock).mockResolvedValue({ id: 'client-1', qbo_customer_id: '55' });
  (prisma.clientInvoice.updateMany as Mock).mockResolvedValue({ count: 0 });
});

describe('POST /api/clients/[id]/invoices/sync', () => {
  it('rejects a tech user with 403', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'tech' });
    const res = await POST(req({ invoices: [] }), ctx);
    expect(res.status).toBe(403);
    expect(prisma.clientInvoice.upsert).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated calls', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req({ invoices: [] }), ctx)).status).toBe(401);
  });

  it('refuses a client with no qbo_customer_id', async () => {
    (prisma.client.findFirst as Mock).mockResolvedValue({ id: 'client-1', qbo_customer_id: null });
    expect((await POST(req({ invoices: [] }), ctx)).status).toBe(409);
  });

  it('upserts by qbo_invoice_id and voids open rows missing from the payload', async () => {
    (prisma.clientInvoice.updateMany as Mock).mockResolvedValue({ count: 1 });
    const res = await POST(req({ invoices: [inv] }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 1, voided: 1 });
    const call = (prisma.clientInvoice.upsert as Mock).mock.calls[0][0];
    expect(call.where).toEqual({ qbo_invoice_id: '101' });
    expect(call.create.client_id).toBe('client-1');
    expect(call.update.balance).toBe(850);
    const um = (prisma.clientInvoice.updateMany as Mock).mock.calls[0][0];
    expect(um.where).toEqual({ client_id: 'client-1', status: { in: ['open', 'overdue'] }, qbo_invoice_id: { notIn: ['101'] } });
    expect(um.data.status).toBe('void');
  });

  it('rejects a malformed invoice with 400', async () => {
    const res = await POST(req({ invoices: [{ ...inv, status: 'bogus' }] }), ctx);
    expect(res.status).toBe(400);
    expect(prisma.clientInvoice.upsert).not.toHaveBeenCalled();
  });
});
