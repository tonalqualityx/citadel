import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.userPreference.findUnique as Mock;
const mockUpsert = prisma.userPreference.upsert as Mock;

function patchReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'admin@example.com' });
});

describe('GET /api/users/me/preferences', () => {
  it('defaults today_view to list when no row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost:3000/api/users/me/preferences'));
    const body = await res.json();
    expect(body.preferences.today_view).toBe('list');
  });

  it('returns the stored today_view', async () => {
    mockFindUnique.mockResolvedValue({
      naming_convention: 'awesome',
      theme: 'system',
      notification_bundle: true,
      today_view: 'board',
    });
    const res = await GET(new NextRequest('http://localhost:3000/api/users/me/preferences'));
    const body = await res.json();
    expect(body.preferences.today_view).toBe('board');
  });
});

describe('PATCH /api/users/me/preferences', () => {
  it('persists today_view=board', async () => {
    mockUpsert.mockResolvedValue({
      naming_convention: 'awesome',
      theme: 'system',
      notification_bundle: true,
      today_view: 'board',
    });

    const res = await PATCH(patchReq({ today_view: 'board' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.preferences.today_view).toBe('board');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ today_view: 'board' }) })
    );
  });

  it('rejects an invalid today_view value', async () => {
    const res = await PATCH(patchReq({ today_view: 'kanban' }));
    expect(res.status).toBe(400);
  });

  it('defaults today_view to list on first create when omitted', async () => {
    mockUpsert.mockResolvedValue({
      naming_convention: 'awesome',
      theme: 'system',
      notification_bundle: true,
      today_view: 'list',
    });
    await PATCH(patchReq({ theme: 'dark' }));
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ today_view: 'list' }) })
    );
  });
});
