import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

// Isolate the route's own orchestration (find-missing / batch / count) from
// resolveCoverUrl's own og:image/network logic, which has its own dedicated test suite
// (lib/services/__tests__/cover-assignment.test.ts).
vi.mock('@/lib/services/cover-assignment', () => ({
  resolveCoverUrl: vi.fn().mockResolvedValue('/covers/some-cover.jpg'),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { resolveCoverUrl } from '@/lib/services/cover-assignment';
import { POST } from '../route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockArcUpdate = prisma.arc.update as Mock;
const mockArcCount = prisma.arc.count as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockTaskCount = prisma.task.count as Mock;
const mockResolveCoverUrl = vi.mocked(resolveCoverUrl);

function postRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/backfill-covers${query}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike', role: 'admin', email: 'mike@becomeindelible.com' } as never);
  mockRequireRole.mockImplementation(() => undefined);
  mockArcUpdate.mockResolvedValue({});
  mockTaskUpdate.mockResolvedValue({});
  mockResolveCoverUrl.mockResolvedValue('/covers/some-cover.jpg');
});

describe('POST /api/oracle/backfill-covers', () => {
  it('requires admin role', async () => {
    mockArcFindMany.mockResolvedValue([]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcCount.mockResolvedValue(0);
    mockTaskCount.mockResolvedValue(0);

    await POST(postRequest());
    expect(mockRequireRole).toHaveBeenCalledWith(expect.anything(), ['admin']);
  });

  it('backfills every arc and open task missing a cover_url', async () => {
    mockArcFindMany.mockResolvedValue([
      { id: 'arc-1', client_id: null },
      { id: 'arc-2', client_id: 'client-1' },
    ]);
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', client_id: null }]);
    mockArcCount.mockResolvedValue(0);
    mockTaskCount.mockResolvedValue(0);

    const res = await POST(postRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockArcUpdate).toHaveBeenCalledTimes(2);
    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      arcs_found_missing: 2,
      tasks_found_missing: 1,
      arcs_backfilled: 2,
      tasks_backfilled: 1,
      arcs_remaining_null: 0,
      tasks_remaining_null: 0,
    });
  });

  it('only queries open (not done/abandoned) tasks missing a cover', async () => {
    mockArcFindMany.mockResolvedValue([]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcCount.mockResolvedValue(0);
    mockTaskCount.mockResolvedValue(0);

    await POST(postRequest());

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cover_url: null,
          is_deleted: false,
          status: { in: ['not_started', 'in_progress', 'review', 'blocked'] },
        }),
      })
    );
  });

  it('dry_run=true reports counts without writing anything', async () => {
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', client_id: null }]);
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', client_id: null }]);

    const res = await POST(postRequest('?dry_run=true'));
    const body = await res.json();

    expect(body.dry_run).toBe(true);
    expect(body.arcs_backfilled).toBe(0);
    expect(body.tasks_backfilled).toBe(0);
    expect(mockArcUpdate).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockArcCount).not.toHaveBeenCalled();
    expect(mockTaskCount).not.toHaveBeenCalled();
  });

  it('reports non-zero remaining if a later count still finds nulls (should not happen in practice, but the response must reflect reality, never assume success)', async () => {
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', client_id: null }]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcCount.mockResolvedValue(1);
    mockTaskCount.mockResolvedValue(0);

    const res = await POST(postRequest());
    const body = await res.json();
    expect(body.arcs_remaining_null).toBe(1);
  });
});
