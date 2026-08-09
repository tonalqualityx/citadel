import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    site: { findMany: vi.fn() },
    siteStatsSnapshot: { findFirst: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockSiteFindMany = prisma.site.findMany as Mock;
const mockSnapshotFindFirst = prisma.siteStatsSnapshot.findFirst as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/stats'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/stats', () => {
  it('returns 401 without a session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockSiteFindMany).not.toHaveBeenCalled();
  });

  it('scopes the site lookup to the session client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockSiteFindMany.mockResolvedValue([]);

    await GET(makeRequest());

    expect(mockSiteFindMany).toHaveBeenCalledWith({
      where: { client_id: 'client-acme', is_deleted: false },
      select: { id: true, name: true },
    });
  });

  it('returns an empty list (quiet placeholder territory) when the client has no sites', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockSiteFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ sites: [] });
    expect(mockSnapshotFindFirst).not.toHaveBeenCalled();
  });

  it('omits sites with no snapshot yet — no fake/zeroed data synthesized', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockSiteFindMany.mockResolvedValue([{ id: 'site-1', name: 'Acme Site' }]);
    mockSnapshotFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.sites).toEqual([]);
  });

  it('projects the latest snapshot per site client-safe, dropping the internal source field', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockSiteFindMany.mockResolvedValue([{ id: 'site-1', name: 'Acme Site' }]);
    mockSnapshotFindFirst.mockResolvedValue({
      site_id: 'site-1',
      captured_at: new Date('2026-08-08T00:00:00Z'),
      period: 'day',
      payload: { leads: { count: 12 }, uptime_pct: 99.9 },
      source: 'ga4-collector',
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({
      site: { id: 'site-1', name: 'Acme Site' },
      period: 'day',
      payload: { leads: { count: 12 }, uptime_pct: 99.9 },
    });
    expect(body.sites[0]).not.toHaveProperty('source');
  });
});
