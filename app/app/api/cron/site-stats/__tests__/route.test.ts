import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    siteStatsSnapshot: { upsert: vi.fn() },
  },
}));

import { POST } from '../route';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockSiteFindFirst = prisma.site.findFirst as Mock;
const mockUpsert = prisma.siteStatsSnapshot.upsert as Mock;

const SITE_ID = '11111111-1111-4111-8111-111111111111';

function postReq(body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }): NextRequest {
  return new NextRequest(new URL('http://localhost/api/cron/site-stats'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  } as any);
}

const validBody = {
  site_id: SITE_ID,
  period: 'day',
  captured_at: '2026-08-08T00:00:00Z',
  source: 'ga4-collector',
  payload: { leads: { count: 12, change_pct: 0.1 }, uptime_pct: 99.9 },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('POST /api/cron/site-stats', () => {
  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(500);
  });

  it('returns 401 when the secret header is missing or wrong', async () => {
    const res = await POST(postReq(validBody, { 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 on a malformed envelope (missing site_id)', async () => {
    const { site_id: _drop, ...rest } = validBody;
    const res = await POST(postReq(rest));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown site_id', async () => {
    mockSiteFindFirst.mockResolvedValue(null);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('upserts a snapshot keyed on site_id + period + captured_at', async () => {
    mockSiteFindFirst.mockResolvedValue({ id: SITE_ID });
    mockUpsert.mockResolvedValue({ id: 'snap-1', captured_at: new Date(validBody.captured_at), period: 'day' });

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.site_id_period_captured_at).toEqual({
      site_id: SITE_ID,
      period: 'day',
      captured_at: new Date(validBody.captured_at),
    });
    expect(call.create.payload).toEqual(validBody.payload);
    expect(call.update.payload).toEqual(validBody.payload);
  });
});
