import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailAsk: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/notifications', () => ({
  notifyUrgentEmail: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { notifyUrgentEmail } from '@/lib/services/notifications';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.emailAsk.findUnique as Mock;
const mockUpsert = prisma.emailAsk.upsert as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockNotifyUrgentEmail = vi.mocked(notifyUrgentEmail);

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/email-sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
  });
}

function baseAsk(overrides: Record<string, unknown> = {}) {
  return {
    message_id: 'msg-1',
    account: 'mike@becomeindelible.com',
    from_email: 'client@herba.com',
    subject: 'Site is down',
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: '2026-07-21T20:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'mike@becomeindelible.com' });
  mockFindUnique.mockResolvedValue(null);
  mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'ask-1', ...create })
  );
  mockUserFindUnique.mockResolvedValue({ id: 'operator-1', email: 'mike@becomeindelible.com' });
});

describe('POST /api/oracle/email-sync', () => {
  it('upserts a non-urgent ask and does not notify', async () => {
    const res = await POST(postRequest({ asks: [baseAsk()] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);
    expect(body.created).toBe(1);
    expect(body.notified_urgent).toBe(0);
    expect(mockNotifyUrgentEmail).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { message_id: 'msg-1' },
        create: expect.objectContaining({ subject: 'Site is down', is_urgent: false }),
      })
    );
  });

  it('notifies the primary operator when a NEW ask is urgent', async () => {
    mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'ask-urgent-1', ...create })
    );

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true, message_id: 'msg-urgent' })] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notified_urgent).toBe(1);
    expect(mockNotifyUrgentEmail).toHaveBeenCalledWith(
      'operator-1',
      'ask-urgent-1',
      'client@herba.com',
      'Site is down'
    );
  });

  it('does not re-notify on a re-sync of an already-urgent ask', async () => {
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: true });

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true })] }));
    const body = await res.json();

    expect(body.notified_urgent).toBe(0);
    expect(body.created).toBe(0);
    expect(mockNotifyUrgentEmail).not.toHaveBeenCalled();
  });

  it('notifies when an existing ask transitions non-urgent -> urgent', async () => {
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false });

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true })] }));
    const body = await res.json();

    expect(body.notified_urgent).toBe(1);
    expect(mockNotifyUrgentEmail).toHaveBeenCalled();
  });

  it('includes from_name in the notification label when present', async () => {
    mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'ask-2', ...create })
    );

    await POST(
      postRequest({
        asks: [baseAsk({ is_urgent: true, message_id: 'msg-2', from_name: 'Jane Client' })],
      })
    );

    expect(mockNotifyUrgentEmail).toHaveBeenCalledWith(
      'operator-1',
      'ask-2',
      'Jane Client <client@herba.com>',
      'Site is down'
    );
  });

  it('rejects a batch over 200', async () => {
    const asks = Array.from({ length: 201 }, (_, i) => baseAsk({ message_id: `msg-${i}` }));
    const res = await POST(postRequest({ asks }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty batch', async () => {
    const res = await POST(postRequest({ asks: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects an ask missing required fields', async () => {
    const res = await POST(postRequest({ asks: [{ message_id: 'msg-x' }] }));
    expect(res.status).toBe(400);
  });

  it('rejects when unauthenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const res = await POST(postRequest({ asks: [baseAsk()] }));
    expect(res.status).toBe(401);
  });
});
