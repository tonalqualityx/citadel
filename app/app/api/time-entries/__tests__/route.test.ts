import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    timeEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTimeEntryCreate = prisma.timeEntry.create as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/time-entries', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockEntry = {
  id: 'entry-1',
  user_id: 'a0000000-0000-1000-8000-000000000001',
  task_id: null,
  project_id: null,
  started_at: new Date(),
  ended_at: new Date(),
  duration: 30,
  is_running: false,
  description: null,
  is_billable: true,
  user: { id: 'a0000000-0000-1000-8000-000000000001', name: 'Admin' },
  task: null,
  project: null,
};

const validBody = {
  started_at: '2026-05-20T09:00:00.000Z',
  ended_at: '2026-05-20T09:30:00.000Z',
  duration: 30,
};

describe('POST /api/time-entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeEntryCreate.mockResolvedValue(mockEntry);
    mockTaskFindUnique.mockResolvedValue(null);
  });

  it('creates entry for self (no user_id override)', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'a0000000-0000-1000-8000-000000000001', role: 'admin', email: 'a@x.com' });

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'a0000000-0000-1000-8000-000000000001' }),
      })
    );
  });

  it('allows admin to create entry for another user', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'a0000000-0000-1000-8000-000000000001', role: 'admin', email: 'a@x.com' });
    mockTimeEntryCreate.mockResolvedValue({ ...mockEntry, user_id: 'a0000000-0000-1000-8000-000000000002' });

    const request = createPostRequest({ ...validBody, user_id: 'a0000000-0000-1000-8000-000000000002' });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'a0000000-0000-1000-8000-000000000002' }),
      })
    );
  });

  it('allows pm to create entry for another user', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'a0000000-0000-1000-8000-000000000003', role: 'pm', email: 'p@x.com' });
    mockTimeEntryCreate.mockResolvedValue({ ...mockEntry, user_id: 'a0000000-0000-1000-8000-000000000002' });

    const request = createPostRequest({ ...validBody, user_id: 'a0000000-0000-1000-8000-000000000002' });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'a0000000-0000-1000-8000-000000000002' }),
      })
    );
  });

  it('rejects tech user creating entry for another user', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'a0000000-0000-1000-8000-000000000002', role: 'tech', email: 't@x.com' });

    const request = createPostRequest({ ...validBody, user_id: 'a0000000-0000-1000-8000-000000000004' });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it('tech user can create entry for self', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'a0000000-0000-1000-8000-000000000002', role: 'tech', email: 't@x.com' });

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'a0000000-0000-1000-8000-000000000002' }),
      })
    );
  });
});
