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

describe('GET home_view', () => {
  const stored = {
    naming_convention: 'awesome',
    theme: 'system',
    notification_bundle: true,
    today_view: 'list',
    energy_filter: 'all',
    home_view: 'home',
  };
  const get = () => GET(new NextRequest('http://localhost:3000/api/users/me/preferences'));

  it('returns overlook for a caller who is not an admin, whatever is stored', async () => {
    for (const role of ['tech', 'pm']) {
      mockRequireAuth.mockResolvedValue({ userId: 'user-2', role, email: 'a@example.com' } as never);
      mockFindUnique.mockResolvedValue({ ...stored });
      const body = await (await get()).json();
      expect(body.preferences.home_view).toBe('overlook');
    }
  });

  it('returns the stored home_view for an admin', async () => {
    mockFindUnique.mockResolvedValue({ ...stored });
    const body = await (await get()).json();
    expect(body.preferences.home_view).toBe('home');
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

describe('home_view', () => {
  it('GET defaults home_view to overlook when no row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost:3000/api/users/me/preferences'));
    const body = await res.json();
    expect(body.preferences.home_view).toBe('overlook');
  });

  it('GET returns a stored home_view of home', async () => {
    mockFindUnique.mockResolvedValue({
      naming_convention: 'awesome',
      theme: 'system',
      notification_bundle: true,
      today_view: 'list',
      energy_filter: 'all',
      home_view: 'home',
    });
    const res = await GET(new NextRequest('http://localhost:3000/api/users/me/preferences'));
    const body = await res.json();
    expect(body.preferences.home_view).toBe('home');
  });

  it('PATCH home_view=home persists for an admin', async () => {
    mockUpsert.mockResolvedValue({ home_view: 'home' });
    const res = await PATCH(patchReq({ home_view: 'home' }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ home_view: 'home' }) })
    );
  });

  it.each(['pm', 'tech'])('PATCH home_view=home returns 403 for %s and never upserts', async (role) => {
    mockRequireAuth.mockResolvedValue({ userId: 'user-2', role, email: 'x@example.com' } as never);
    const res = await PATCH(patchReq({ home_view: 'home' }));
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('PATCH home_view=overlook succeeds for a tech user', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'user-2', role: 'tech', email: 'x@example.com' } as never);
    mockUpsert.mockResolvedValue({ home_view: 'overlook' });
    const res = await PATCH(patchReq({ home_view: 'overlook' }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('PATCH rejects an invalid home_view value with 400', async () => {
    const res = await PATCH(patchReq({ home_view: 'kanban' }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
