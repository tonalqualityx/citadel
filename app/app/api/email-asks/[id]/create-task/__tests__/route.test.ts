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
    task: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    client: {
      findMany: vi.fn(),
    },
    arc: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockAskFindUnique = prisma.emailAsk.findUnique as Mock;
const mockAskUpdate = prisma.emailAsk.update as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockTaskCreate = prisma.task.create as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockClientFindMany = prisma.client.findMany as Mock;
const mockArcFindMany = prisma.arc.findMany as Mock;

function ask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: 'Jane Client',
    from_email: 'jane@herba.com',
    subject: 'Re: Fwd: Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function req(body: object | undefined = undefined): NextRequest {
  return new NextRequest('http://localhost:3000/api/email-asks/ask-1/create-task', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
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
  mockUserFindUnique.mockResolvedValue({ id: 'operator-1', email: 'mike@becomeindelible.com' });
  mockClientFindMany.mockResolvedValue([]);
  mockAskUpdate.mockResolvedValue({});
});

describe('POST /api/email-asks/[id]/create-task', () => {
  it('creates a task prefilled from the ask, strips Re:/Fwd:, sets task_id + handled', async () => {
    mockAskFindUnique.mockResolvedValue(ask());
    mockTaskCreate.mockResolvedValue({ id: 'task-1', title: 'Site is down' });

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('task-1');
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Site is down',
          status: 'not_started',
          priority: 1, // client_blocking
          assignee_id: 'operator-1',
          source: 'email',
          source_ref: 'msg-1',
          origin_url: ask().deep_link,
          client_id: null,
          arc_id: null,
        }),
      })
    );
    expect(mockAskUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { task_id: 'task-1', state: 'handled' },
    });
  });

  it('matches a client by from_email domain', async () => {
    mockAskFindUnique.mockResolvedValue(ask());
    mockClientFindMany.mockResolvedValue([{ id: 'client-1', email: 'contact@herba.com' }]);
    mockTaskCreate.mockResolvedValue({ id: 'task-2' });

    await POST(req(), ctx());

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ client_id: 'client-1' }) })
    );
  });

  it('is idempotent: returns the existing task with 200 when task_id is already set', async () => {
    mockAskFindUnique.mockResolvedValue(ask({ task_id: 'existing-task' }));
    mockTaskFindUnique.mockResolvedValue({ id: 'existing-task', title: 'Already created' });

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('existing-task');
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('creates fresh when task_id points at a task that no longer exists', async () => {
    mockAskFindUnique.mockResolvedValue(ask({ task_id: 'deleted-task' }));
    mockTaskFindUnique.mockResolvedValue(null);
    mockTaskCreate.mockResolvedValue({ id: 'task-3' });

    const res = await POST(req(), ctx());
    expect(res.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalled();
  });

  it('passes through arc_name via the shared arc-resolution helper', async () => {
    mockAskFindUnique.mockResolvedValue(ask());
    mockArcFindMany.mockResolvedValue([]);
    (prisma.arc.create as Mock).mockResolvedValue({ id: 'arc-new' });
    mockTaskCreate.mockResolvedValue({ id: 'task-4' });

    await POST(req({ arc_name: 'Herba site incident' }), ctx());

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: 'arc-new' }) })
    );
  });

  it('passes through sop_id with no resolution logic', async () => {
    mockAskFindUnique.mockResolvedValue(ask());
    mockTaskCreate.mockResolvedValue({ id: 'task-5' });

    await POST(req({ sop_id: '11111111-1111-4111-8111-111111111111' }), ctx());

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sop_id: '11111111-1111-4111-8111-111111111111' }),
      })
    );
  });

  it('404s when the ask does not exist', async () => {
    mockAskFindUnique.mockResolvedValue(null);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('500s when the default assignee is missing', async () => {
    mockAskFindUnique.mockResolvedValue(ask());
    mockUserFindUnique.mockResolvedValue(null);

    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
  });
});
