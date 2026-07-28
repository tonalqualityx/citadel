import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ritualRun: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindUnique = prisma.ritualRun.findUnique as Mock;
const mockUpsert = prisma.ritualRun.upsert as Mock;
const mockUserPreferenceFindUnique = prisma.userPreference.findUnique as Mock;

function getReq(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/ritual-runs?${searchParams.toString()}`);
}

function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/ritual-runs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockUserPreferenceFindUnique.mockResolvedValue(null); // falls back to default timezone
});

describe('GET /api/ritual-runs', () => {
  it('returns nulls when no row exists yet for the day', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(getReq({ date: '2026-07-27' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe('morning');
    expect(body.ran_at).toBeNull();
    expect(body.bailed_at).toBeNull();
  });

  it('returns the existing ran_at/bailed_at when a row exists', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: new Date('2026-07-27T09:00:00.000Z'),
      bailed_at: null,
    });

    const res = await GET(getReq({ date: '2026-07-27' }));
    const body = await res.json();

    expect(body.ran_at).not.toBeNull();
    expect(body.bailed_at).toBeNull();
  });

  it('defaults kind to morning when omitted', async () => {
    mockFindUnique.mockResolvedValue(null);
    await GET(getReq({ date: '2026-07-27' }));
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date_kind: expect.objectContaining({ kind: 'morning' }) } })
    );
  });

  it('403s a non-admin caller', async () => {
    mockRequireRole.mockImplementation(() => {
      throw new ApiError('Forbidden', 403);
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/ritual-runs', () => {
  it('creates a new row on the first bail of the day', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: null,
      bailed_at: new Date('2026-07-27T09:00:00.000Z'),
    });

    const res = await POST(postReq({ date: '2026-07-27', action: 'bailed' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bailed_at).not.toBeNull();
    expect(body.ran_at).toBeNull();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.bailed_at).toBeInstanceOf(Date);
    expect(call.create.ran_at).toBeNull();
  });

  it('is idempotent — a repeat POST for the same action never errors and stays a single row (upsert)', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: null,
      bailed_at: new Date('2026-07-27T09:05:00.000Z'),
    });

    const res1 = await POST(postReq({ date: '2026-07-27', action: 'bailed' }));
    const res2 = await POST(postReq({ date: '2026-07-27', action: 'bailed' }));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('a ran action never touches bailed_at on update', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: new Date(),
      bailed_at: new Date('2026-07-27T09:00:00.000Z'),
    });

    await POST(postReq({ date: '2026-07-27', action: 'ran' }));
    const call = mockUpsert.mock.calls[0][0];
    expect(call.update).toEqual({ ran_at: expect.any(Date) });
    expect(call.update.bailed_at).toBeUndefined();
  });

  it('rejects an invalid action', async () => {
    const res = await POST(postReq({ date: '2026-07-27', action: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('defaults date to the resolved-timezone today when omitted', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date(),
      kind: 'morning',
      ran_at: null,
      bailed_at: new Date(),
    });
    const res = await POST(postReq({ action: 'bailed' }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });
});

describe('POST /api/ritual-runs — Quick-start (Clarity Phase 8)', () => {
  it('quickstart:true with action=ran stamps BOTH ran_at and quickstart_at', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: new Date(),
      bailed_at: null,
      quickstart_at: new Date(),
    });

    const res = await POST(postReq({ date: '2026-07-27', action: 'ran', quickstart: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ran_at).not.toBeNull();
    expect(body.quickstart_at).not.toBeNull();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.quickstart_at).toBeInstanceOf(Date);
    expect(call.update.quickstart_at).toBeInstanceOf(Date);
  });

  it('a later plain `ran` (no quickstart) the same day does not clear an already-set quickstart_at (never included in the update)', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: new Date(),
      bailed_at: null,
      quickstart_at: new Date('2026-07-27T07:00:00.000Z'),
    });

    await POST(postReq({ date: '2026-07-27', action: 'ran' }));
    const call = mockUpsert.mock.calls[0][0];
    expect(call.update).toEqual({ ran_at: expect.any(Date) });
    expect(call.update.quickstart_at).toBeUndefined();
  });

  it('quickstart:true with action=bailed is a no-op for quickstart_at (only meaningful with action=ran)', async () => {
    mockUpsert.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: null,
      bailed_at: new Date(),
      quickstart_at: null,
    });

    await POST(postReq({ date: '2026-07-27', action: 'bailed', quickstart: true }));
    const call = mockUpsert.mock.calls[0][0];
    expect(call.update.quickstart_at).toBeUndefined();
    expect(call.create.quickstart_at).toBeNull();
  });

  it('GET returns quickstart_at', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'r1',
      date: new Date('2026-07-27T00:00:00.000Z'),
      kind: 'morning',
      ran_at: new Date(),
      bailed_at: null,
      quickstart_at: new Date(),
    });

    const res = await GET(getReq({ date: '2026-07-27' }));
    const body = await res.json();
    expect(body.quickstart_at).not.toBeNull();
  });
});
