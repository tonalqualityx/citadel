import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../route';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock activity logging
vi.mock('@/lib/services/activity', () => ({
  logDelete: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logDelete } from '@/lib/services/activity';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockFindUnique = prisma.apiKey.findUnique as Mock;
const mockUpdate = prisma.apiKey.update as Mock;
const mockLogDelete = logDelete as Mock;

const authPayload = { userId: 'user-123', email: 'test@example.com', role: 'pm' };

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/api-keys/key-1', {
    method: 'DELETE',
  });
}

function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/api-keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(authPayload);
    mockUpdate.mockResolvedValue({});
    mockLogDelete.mockResolvedValue(undefined);
  });

  it('revokes key owned by user (sets is_revoked = true)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'key-1',
      user_id: 'user-123',
      name: 'My Key',
    });

    const response = await DELETE(createDeleteRequest(), createParams('key-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('API key revoked');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { is_revoked: true },
    });
  });

  it('returns 404 for non-existent key', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), createParams('nonexistent'));

    expect(response.status).toBe(404);
  });

  it('returns 403 when trying to revoke another user\'s key', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'key-1',
      user_id: 'other-user-456',
      name: 'Their Key',
    });

    const response = await DELETE(createDeleteRequest(), createParams('key-1'));

    expect(response.status).toBe(403);
  });

  it('logs activity via logDelete', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'key-1',
      user_id: 'user-123',
      name: 'My Key',
    });

    await DELETE(createDeleteRequest(), createParams('key-1'));

    expect(mockLogDelete).toHaveBeenCalledWith('user-123', 'api_key', 'key-1', 'My Key');
  });

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const response = await DELETE(createDeleteRequest(), createParams('key-1'));

    expect(response.status).toBe(401);
  });
});
