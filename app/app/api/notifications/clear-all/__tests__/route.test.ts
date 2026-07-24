import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: {
      deleteMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockDeleteMany = prisma.notification.deleteMany as Mock;

const TEST_USER_ID = 'user-123';

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/notifications/clear-all', {
    method: 'POST',
  });
}

describe('POST /api/notifications/clear-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: TEST_USER_ID,
      role: 'tech',
      email: 'user@example.com',
    });
    mockDeleteMany.mockResolvedValue({ count: 3 });
  });

  it('deletes all notifications for the authenticated user only', async () => {
    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(3);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { user_id: TEST_USER_ID },
    });
  });

  it('returns deleted: 0 when there are no notifications', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(0);
  });

  it('returns an error status when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(createRequest());

    expect(response.status).toBe(500); // handleApiError maps generic errors to 500
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
