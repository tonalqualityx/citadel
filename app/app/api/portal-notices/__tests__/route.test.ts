import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({ prisma: { portalNotice: { findMany: vi.fn() } } }));
vi.mock('@/lib/portal/notices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/notices')>();
  return { ...actual, cancelStaleNotices: vi.fn(async () => 0) };
});

import { GET } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { cancelStaleNotices } from '@/lib/portal/notices';

const get = (qs = '') => GET(new NextRequest(new URL(`http://localhost/api/portal-notices${qs}`)));
const findMany = prisma.portalNotice.findMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'oracle', role: 'pm' });
  findMany.mockResolvedValue([{ id: 'n1' }]);
});

describe('GET /api/portal-notices', () => {
  it('is pm and admin only', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u', role: 'tech' });
    expect((await get()).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('401s without auth', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await get()).status).toBe(401);
  });
  it('cancels stale notices first, then returns queued ones quiet for the 120 second hold', async () => {
    const before = Date.now();
    const res = await get('?status=queued&older_than=120');
    expect(await res.json()).toEqual({ notices: [{ id: 'n1' }] });
    expect(cancelStaleNotices).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('queued');
    const cutoff = (where.updated_at.lte as Date).getTime();
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 119_000);
    expect(cutoff).toBeGreaterThanOrEqual(before - 121_000);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ created_at: 'asc' });
  });
  it('the hold applies by default, so a caller that forgets older_than still waits two minutes', async () => {
    await get();
    const cutoff = (findMany.mock.calls[0][0].where.updated_at.lte as Date).getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(119_000);
  });
  it('other statuses are listed without the hold or the cancel pass', async () => {
    await get('?status=failed');
    expect(cancelStaleNotices).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'failed' });
  });
  it('rejects a bad status, task id or older_than', async () => {
    expect((await get('?status=nope')).status).toBe(400);
    expect((await get('?task_id=x')).status).toBe(400);
    expect((await get('?older_than=-5')).status).toBe(400);
  });
});
