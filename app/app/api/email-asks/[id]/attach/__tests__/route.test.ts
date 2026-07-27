import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

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
    arc: {
      findUnique: vi.fn(),
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
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;

const ARC_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TASK_UUID = '550e8400-e29b-41d4-a716-446655440001';

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
    arc_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function req(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/email-asks/ask-1/attach', {
    method: 'POST',
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

describe('POST /api/email-asks/[id]/attach', () => {
  it('attaches to an arc and marks the ask handled', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockArcFindUnique.mockResolvedValue({ id: ARC_UUID });
    mockUpdate.mockResolvedValue(ask({ arc_id: ARC_UUID, state: 'handled' }));

    const res = await POST(req({ arc_id: ARC_UUID }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.arc_id).toBe(ARC_UUID);
    expect(body.state).toBe('handled');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { arc_id: ARC_UUID, state: 'handled' },
    });
  });

  it('attaches to a task and marks the ask handled', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue({ id: TASK_UUID });
    mockUpdate.mockResolvedValue(ask({ task_id: TASK_UUID, state: 'handled' }));

    const res = await POST(req({ task_id: TASK_UUID }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.task_id).toBe(TASK_UUID);
    expect(body.state).toBe('handled');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { task_id: TASK_UUID, state: 'handled' },
    });
  });

  it('rejects a body with neither arc_id nor task_id', async () => {
    mockFindUnique.mockResolvedValue(ask());
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a body with BOTH arc_id and task_id', async () => {
    mockFindUnique.mockResolvedValue(ask());
    const res = await POST(req({ arc_id: ARC_UUID, task_id: TASK_UUID }), ctx());
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the ask does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await POST(req({ arc_id: ARC_UUID }), ctx());
    expect(res.status).toBe(404);
  });

  it('404s when arc_id does not reference an existing arc', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockArcFindUnique.mockResolvedValue(null);

    const res = await POST(req({ arc_id: ARC_UUID }), ctx());
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when task_id does not reference an existing task', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue(null);

    const res = await POST(req({ task_id: TASK_UUID }), ctx());
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent: re-attaching the same arc_id succeeds again with no error', async () => {
    mockFindUnique.mockResolvedValue(ask({ arc_id: ARC_UUID, state: 'handled' }));
    mockArcFindUnique.mockResolvedValue({ id: ARC_UUID });
    mockUpdate.mockResolvedValue(ask({ arc_id: ARC_UUID, state: 'handled' }));

    const res = await POST(req({ arc_id: ARC_UUID }), ctx());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { arc_id: ARC_UUID, state: 'handled' },
    });
  });

  it('requires admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await POST(req({ arc_id: ARC_UUID }), ctx());
    expect(res.status).toBe(403);
  });
});
