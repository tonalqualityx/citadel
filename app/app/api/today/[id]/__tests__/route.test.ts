import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH, DELETE } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    todayPick: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    oracleSession: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindUnique = prisma.todayPick.findUnique as Mock;
const mockUpdate = prisma.todayPick.update as Mock;
const mockDelete = prisma.todayPick.delete as Mock;
const mockSessionFindFirst = prisma.oracleSession.findFirst as Mock;

function pick(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pick-1',
    date: new Date('2026-07-21T00:00:00.000Z'),
    item_type: 'note',
    arc_id: null,
    arc: null,
    task_id: null,
    task: null,
    session_external_id: null,
    charter_id: null,
    charter: null,
    label: 'Call the bank',
    sort: 0,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function req(body: object, method: 'PATCH' | 'DELETE' = 'PATCH'): NextRequest {
  return new NextRequest('http://localhost:3000/api/today/pick-1', {
    method,
    body: method === 'PATCH' ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: 'pick-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockSessionFindFirst.mockResolvedValue(null);
});

describe('PATCH /api/today/[id]', () => {
  it('marks a pick complete', async () => {
    mockFindUnique.mockResolvedValue(pick());
    mockUpdate.mockResolvedValue(pick({ completed_at: new Date('2026-07-21T15:00:00.000Z') }));

    const res = await PATCH(req({ completed_at: '2026-07-21T15:00:00.000Z' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.completed_at).toBeTruthy();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completed_at: expect.any(Date) }),
      })
    );
  });

  it('un-completes a pick when completed_at is explicitly null', async () => {
    mockFindUnique.mockResolvedValue(pick({ completed_at: new Date() }));
    mockUpdate.mockResolvedValue(pick({ completed_at: null }));

    const res = await PATCH(req({ completed_at: null }), ctx());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completed_at: null }) })
    );
  });

  it('updates sort and label', async () => {
    mockFindUnique.mockResolvedValue(pick());
    mockUpdate.mockResolvedValue(pick({ sort: 3, label: 'Renamed' }));

    const res = await PATCH(req({ sort: 3, label: 'Renamed' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sort).toBe(3);
    expect(body.label).toBe('Renamed');
  });

  it('404s when the pick does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PATCH(req({ sort: 1 }), ctx());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/today/[id]', () => {
  it('removes the pick row (not the underlying item)', async () => {
    mockFindUnique.mockResolvedValue(pick());
    mockDelete.mockResolvedValue(pick());

    const res = await DELETE(req({}, 'DELETE'), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'pick-1' } });
  });

  it('404s when the pick does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(req({}, 'DELETE'), ctx());
    expect(res.status).toBe(404);
  });
});
