import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    site: { findUnique: vi.fn() },
    brandProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockSiteFindUnique = prisma.site.findUnique as Mock;
const mockProfileFindFirst = prisma.brandProfile.findFirst as Mock;
const mockProfileCreate = prisma.brandProfile.create as Mock;
const mockProfileUpdate = prisma.brandProfile.update as Mock;

const SITE_ID = 'site-1';
const CLIENT_ID = 'client-1';
const params = Promise.resolve({ id: SITE_ID });

function putReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/sites/${SITE_ID}/brand-profile`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// findFirst is called once for the site profile, once for the client profile (in that order).
function mockProfiles(own: unknown, client: unknown) {
  mockProfileFindFirst.mockReset();
  mockProfileFindFirst.mockResolvedValueOnce(own).mockResolvedValueOnce(client);
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks clears call history but NOT queued mockResolvedValueOnce values — reset the
  // findFirst queue so a path that consumes fewer calls can't leak into the next test.
  mockProfileFindFirst.mockReset();
  mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
});

describe('GET /api/sites/[id]/brand-profile', () => {
  it('404s when the site does not exist', async () => {
    mockSiteFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), { params });
    expect(res.status).toBe(404);
  });

  it('resolves per-field: site overrides where set, inherits the rest from the client', async () => {
    mockSiteFindUnique.mockResolvedValue({ id: SITE_ID, client_id: CLIENT_ID });
    mockProfiles(
      { id: 'site-bp', site_id: SITE_ID, figma_url: 'https://figma/site' },
      { id: 'client-bp', client_id: CLIENT_ID, figma_url: 'https://figma/client', voice_profile: 'client voice' }
    );

    const res = await GET(new NextRequest('http://localhost/x'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile.id).toBe('site-bp');
    expect(body.inherited.id).toBe('client-bp');
    expect(body.resolved.figma_url).toEqual({ value: 'https://figma/site', source: 'site' });
    expect(body.resolved.voice_profile).toEqual({ value: 'client voice', source: 'client' });
    expect(body.resolved.notes).toEqual({ value: null, source: null });
  });

  it('handles a site with no client (no inheritance)', async () => {
    mockSiteFindUnique.mockResolvedValue({ id: SITE_ID, client_id: null });
    mockProfiles({ id: 'site-bp', site_id: SITE_ID, notes: 'standalone' }, null);

    const res = await GET(new NextRequest('http://localhost/x'), { params });
    const body = await res.json();
    expect(body.inherited).toBeNull();
    expect(body.resolved.notes).toEqual({ value: 'standalone', source: 'site' });
  });
});

describe('PUT /api/sites/[id]/brand-profile', () => {
  it('creates the site profile (with site_id) when none exists and returns the resolved payload', async () => {
    mockSiteFindUnique.mockResolvedValue({ id: SITE_ID, name: 'Acme Site', client_id: CLIENT_ID });
    // 1st findFirst = existing-own check (null); then buildSitePayload's two findFirsts.
    mockProfileFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'site-bp', site_id: SITE_ID, figma_url: 'https://f' })
      .mockResolvedValueOnce(null);
    mockProfileCreate.mockResolvedValue({ id: 'site-bp', site_id: SITE_ID, figma_url: 'https://f' });

    const res = await PUT(putReq({ figma_url: 'https://f' }), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockProfileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ site_id: SITE_ID, figma_url: 'https://f' }) })
    );
    expect(body.resolved.figma_url).toEqual({ value: 'https://f', source: 'site' });
  });

  it('updates the existing site profile instead of duplicating', async () => {
    mockSiteFindUnique.mockResolvedValue({ id: SITE_ID, name: 'Acme Site', client_id: CLIENT_ID });
    mockProfileFindFirst
      .mockResolvedValueOnce({ id: 'site-bp' }) // existing-own check
      .mockResolvedValueOnce({ id: 'site-bp', site_id: SITE_ID }) // payload: own
      .mockResolvedValueOnce(null); // payload: client
    mockProfileUpdate.mockResolvedValue({ id: 'site-bp', site_id: SITE_ID });

    const res = await PUT(putReq({ notes: 'updated' }), { params });
    expect(res.status).toBe(200);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'site-bp' } })
    );
    expect(mockProfileCreate).not.toHaveBeenCalled();
  });
});
