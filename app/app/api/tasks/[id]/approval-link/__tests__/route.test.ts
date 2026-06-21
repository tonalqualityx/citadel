import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/portal', () => ({
  generatePortalToken: vi.fn(() => 'fresh-token'),
  getTokenExpiry: vi.fn(() => new Date('2026-08-20T00:00:00Z')),
}));

import { POST } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { generatePortalToken } from '@/lib/services/portal';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockRequireRole = requireRole as Mock;
const mockFindUnique = prisma.task.findUnique as Mock;
const mockUpdate = prisma.task.update as Mock;
const mockGenerate = generatePortalToken as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/tasks/task-1/approval-link'), { method: 'POST' } as any);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/tasks/:id/approval-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@test.com' });
    mockRequireRole.mockReturnValue(undefined);
  });

  it('mints a fresh token when the task has none and returns the public URL', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: null,
      portal_token_expires_at: null,
    });
    mockUpdate.mockResolvedValue({});

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalled();
    expect(data.token).toBe('fresh-token');
    expect(data.url).toContain('/portal/task-approval/fresh-token');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ portal_token: 'fresh-token' }),
    });
  });

  it('reuses an existing unexpired token without minting a new one', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: 'existing-token',
      portal_token_expires_at: new Date(Date.now() + 86400000),
    });

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.token).toBe('existing-token');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('re-mints when the existing token is expired', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: 'old-token',
      portal_token_expires_at: new Date(Date.now() - 1000),
    });
    mockUpdate.mockResolvedValue({});

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(data.token).toBe('fresh-token');
    expect(mockGenerate).toHaveBeenCalled();
  });

  it('returns 404 for a missing or deleted task', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Task not found');
  });
});
