import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { apiKeyViolation: { findMany: vi.fn() } } }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { GET } from '../route';

const auth = requireAuth as Mock;
const findMany = prisma.apiKeyViolation.findMany as Mock;
const get = (qs = '') => GET(new NextRequest(`http://localhost:3000/api/admin/key-violations${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: 'v1', key_prefix: 'citadel_0123abcd', lane: 'courier', method: 'GET', path: '/api/sites', enforced: false }]);
});

describe('GET /api/admin/key-violations', () => {
  it('admin reads violations filtered by key prefix and since', async () => {
    auth.mockResolvedValue({ userId: 'a', email: 'a@x', role: 'admin' });
    const res = await get('?key_prefix=citadel_0123abcd&since=2026-10-25T10:00:00Z');
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { key_prefix: 'citadel_0123abcd', at: { gte: new Date('2026-10-25T10:00:00Z') } },
      orderBy: { at: 'desc' },
      take: 200,
    });
  });

  it('no filters reads the newest rows', async () => {
    auth.mockResolvedValue({ userId: 'a', email: 'a@x', role: 'admin' });
    expect((await get()).status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({ where: {}, orderBy: { at: 'desc' }, take: 200 });
  });

  it('a pm gets 403', async () => {
    auth.mockResolvedValue({ userId: 'p', email: 'p@x', role: 'pm' });
    expect((await get()).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bad since is 400', async () => {
    auth.mockResolvedValue({ userId: 'a', email: 'a@x', role: 'admin' });
    expect((await get('?since=yesterday')).status).toBe(400);
  });
});
