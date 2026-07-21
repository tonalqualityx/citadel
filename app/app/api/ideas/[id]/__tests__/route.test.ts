import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    idea: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockIdeaFindUnique = prisma.idea.findUnique as Mock;
const mockIdeaUpdate = prisma.idea.update as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;

function idea(overrides: Record<string, unknown> = {}) {
  return {
    id: 'idea-1',
    text: 'An idea',
    source: 'session',
    source_ref: null,
    status: 'open',
    promoted_task_id: null,
    promoted_task: null,
    created_by_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/ideas/idea-1');
}

function patchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/ideas/idea-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'idea-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
  mockIdeaFindUnique.mockResolvedValue(idea());
});

describe('GET /api/ideas/[id]', () => {
  it('returns the idea', async () => {
    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('idea-1');
  });

  it('404s when not found', async () => {
    mockIdeaFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(), { params });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/ideas/[id]', () => {
  it('updates status', async () => {
    mockIdeaUpdate.mockResolvedValue(idea({ status: 'kept' }));

    const res = await PATCH(patchRequest({ status: 'kept' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('kept');
  });

  it('updates text', async () => {
    mockIdeaUpdate.mockResolvedValue(idea({ text: 'Updated' }));
    const res = await PATCH(patchRequest({ text: 'Updated' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.text).toBe('Updated');
  });

  it('rejects an invalid status enum', async () => {
    const res = await PATCH(patchRequest({ status: 'bogus' }), { params });
    expect(res.status).toBe(400);
  });

  it('404s when the idea does not exist', async () => {
    mockIdeaFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ status: 'kept' }), { params });
    expect(res.status).toBe(404);
  });

  it('promoting to a task validates the task exists (404 when missing)', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ status: 'promoted', promoted_task_id: '550e8400-e29b-41d4-a716-446655440000' }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task not found');
  });

  it('promotes an idea to an existing task', async () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440000';
    mockTaskFindUnique.mockResolvedValue({ id: taskId });
    mockIdeaUpdate.mockResolvedValue(idea({ status: 'promoted', promoted_task_id: taskId }));

    const res = await PATCH(patchRequest({ status: 'promoted', promoted_task_id: taskId }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('promoted');
    expect(body.promoted_task_id).toBe(taskId);
    expect(mockIdeaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'promoted', promoted_task_id: taskId }),
      })
    );
  });
});
