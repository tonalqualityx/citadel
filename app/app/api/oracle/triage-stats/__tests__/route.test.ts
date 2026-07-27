import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    triageStat: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.triageStat.findUnique as Mock;
const mockUpsert = prisma.triageStat.upsert as Mock;

function getReq(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/oracle/triage-stats?${searchParams.toString()}`);
}

function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/triage-stats', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/oracle/triage-stats', () => {
  it('returns 0 when no row exists yet for the day', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'mike@becomeindelible.com' });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(getReq({ date: '2026-07-27' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.archived_count).toBe(0);
    expect(body.date).toBe('2026-07-27');
  });

  it('returns the stored count when a row exists', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'mike@becomeindelible.com' });
    mockFindUnique.mockResolvedValue({ archived_count: 7, date: new Date('2026-07-27T00:00:00.000Z') });

    const res = await GET(getReq({ date: '2026-07-27' }));
    const body = await res.json();

    expect(body.archived_count).toBe(7);
  });
});

describe('POST /api/oracle/triage-stats', () => {
  it('is bot-only — rejects a non-bot caller', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'mike@becomeindelible.com' });

    const res = await POST(postReq({ archived_count: 3 }));
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('the oracle bot upserts by date', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'bot', role: 'admin', email: 'oracle@indelible.bot' });
    mockUpsert.mockResolvedValue({ date: new Date('2026-07-27T00:00:00.000Z'), archived_count: 5 });

    const res = await POST(postReq({ date: '2026-07-27', archived_count: 5 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.archived_count).toBe(5);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: new Date('2026-07-27T00:00:00.000Z') },
        create: { date: new Date('2026-07-27T00:00:00.000Z'), archived_count: 5 },
        update: { archived_count: 5 },
      })
    );
  });
});
