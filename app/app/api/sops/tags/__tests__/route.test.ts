import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sop: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockSopFindMany = prisma.sop.findMany as Mock;

describe('GET /api/sops/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'tech',
      email: 'tech@example.com',
    });
  });

  it('returns a sorted, de-duplicated list of tags across active SOPs', async () => {
    mockSopFindMany.mockResolvedValue([
      { tags: ['stack:custom', 'kind:setup'] },
      { tags: ['kind:setup', 'documentation'] },
      { tags: [] },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tags).toEqual(['documentation', 'kind:setup', 'stack:custom']);
  });

  it('only considers active SOPs', async () => {
    mockSopFindMany.mockResolvedValue([]);

    await GET();

    expect(mockSopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_active: true },
        select: { tags: true },
      })
    );
  });

  it('returns an empty array when no SOPs have tags', async () => {
    mockSopFindMany.mockResolvedValue([{ tags: [] }, { tags: null }]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tags).toEqual([]);
  });
});
