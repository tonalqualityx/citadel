import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailAsk: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindUnique = prisma.emailAsk.findUnique as Mock;
const mockUpdate = prisma.emailAsk.update as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;

function ask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: null,
    from_email: 'client@herba.com',
    subject: 'Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    training_note: null,
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function req(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/email-asks/ask-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: 'ask-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
});

describe('PATCH /api/email-asks/[id]', () => {
  it('marks an ask handled', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockUpdate.mockResolvedValue(ask({ state: 'handled' }));

    const res = await PATCH(req({ state: 'handled' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe('handled');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { state: 'handled' },
    });
  });

  it('dismisses an ask', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockUpdate.mockResolvedValue(ask({ state: 'dismissed' }));

    const res = await PATCH(req({ state: 'dismissed' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('dismissed');
  });

  it('sets task_id after verifying the task exists', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mockUpdate.mockResolvedValue(ask({ task_id: '11111111-1111-4111-8111-111111111111' }));

    const res = await PATCH(req({ task_id: '11111111-1111-4111-8111-111111111111' }), ctx());
    expect(res.status).toBe(200);
    expect(mockTaskFindUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111', is_deleted: false },
    });
  });

  it('404s when task_id does not reference an existing task', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue(null);

    const res = await PATCH(req({ task_id: '22222222-2222-4222-8222-222222222222' }), ctx());
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the ask does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await PATCH(req({ state: 'handled' }), ctx());
    expect(res.status).toBe(404);
  });

  it('rejects an invalid state value', async () => {
    mockFindUnique.mockResolvedValue(ask());
    const res = await PATCH(req({ state: 'archived' }), ctx());
    expect(res.status).toBe(400);
  });

  it('requires admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await PATCH(req({ state: 'handled' }), ctx());
    expect(res.status).toBe(403);
  });

  describe('Clarity Phase 4b — archive_requested + training_note', () => {
    it('accepts archive_requested as a valid state (the intake drawer\'s Archive action)', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ state: 'archive_requested' }));

      const res = await PATCH(req({ state: 'archive_requested' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.state).toBe('archive_requested');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'archive_requested' },
      });
    });

    it('sets a training_note', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ training_note: 'this was actually noise, not client' }));

      const res = await PATCH(req({ training_note: 'this was actually noise, not client' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.training_note).toBe('this was actually noise, not client');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { training_note: 'this was actually noise, not client' },
      });
    });

    it('clears a training_note when explicitly null', async () => {
      mockFindUnique.mockResolvedValue(ask({ training_note: 'old note' }));
      mockUpdate.mockResolvedValue(ask({ training_note: null }));

      const res = await PATCH(req({ training_note: null }), ctx());
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { training_note: null },
      });
    });

    it('rejects a training_note over 2000 characters', async () => {
      mockFindUnique.mockResolvedValue(ask());
      const res = await PATCH(req({ training_note: 'x'.repeat(2001) }), ctx());
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
