import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/portal/chat/outbox-guard', () => ({ chatRecipientAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailOutbox: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    clientContact: { count: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const ID = '77777777-7777-4777-8777-777777777777';
const claim = () => POST(new NextRequest(`http://localhost/api/email-outbox/${ID}/claim`, { method: 'POST' }), { params: Promise.resolve({ id: ID }) });
const row = (over: Record<string, unknown> = {}) => ({ id: ID, kind: 'price_review', to: 'dana@acme.example', cc: null, task_id: null, sent_at: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@example.com' });
  (requireRole as Mock).mockImplementation(() => {});
  (prisma.emailOutbox.updateMany as Mock).mockResolvedValue({ count: 1 });
});

describe('claiming a price review row', () => {
  it('hands it to the drain when the address is still a portal owner of a client with an active charter', async () => {
    (prisma.emailOutbox.findUnique as Mock).mockResolvedValue(row());
    (prisma.clientContact.count as Mock).mockResolvedValue(1);
    const res = await claim();
    expect(res.status).toBe(200);
    expect(prisma.emailOutbox.update).not.toHaveBeenCalled();
  });

  it('refuses it when the contact is gone or no longer an owner', async () => {
    (prisma.emailOutbox.findUnique as Mock).mockResolvedValue(row());
    (prisma.clientContact.count as Mock).mockResolvedValue(0);
    expect((await claim()).status).toBe(409);
    expect((prisma.emailOutbox.update as Mock).mock.calls[0][0].data.attempts).toBe(99);
  });

  it('refuses a copy line or more than one address without asking the database', async () => {
    for (const r of [row({ cc: 'x@acme.example' }), row({ to: 'a@acme.example, b@acme.example' }), row({ to: 'a@acme.example;b@acme.example' })]) {
      (prisma.emailOutbox.findUnique as Mock).mockResolvedValue(r);
      expect((await claim()).status).toBe(409);
    }
    expect(prisma.clientContact.count).not.toHaveBeenCalled();
  });

  it('leaves other kinds of mail alone', async () => {
    (prisma.emailOutbox.findUnique as Mock).mockResolvedValue(row({ kind: 'other' }));
    expect((await claim()).status).toBe(200);
    expect(prisma.clientContact.count).not.toHaveBeenCalled();
  });
});
