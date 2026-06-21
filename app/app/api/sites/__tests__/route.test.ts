import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    site: { create: vi.fn() },
    client: { findUnique: vi.fn() },
    hostingPlan: { findUnique: vi.fn() },
    maintenancePlan: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockSiteCreate = prisma.site.create as Mock;
const mockClientFind = prisma.client.findUnique as Mock;

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sites', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/sites — repo config on create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
    mockClientFind.mockResolvedValue({ id: CLIENT_ID, is_deleted: false });
    mockSiteCreate.mockResolvedValue({ id: 's1', name: 'Site', client_id: CLIENT_ID });
  });

  it('accepts and persists repo_url/repo_branch so a site can be created with its repo in one call', async () => {
    const res = await POST(
      postReq({
        name: 'New Site',
        client_id: CLIENT_ID,
        site_type: 'eleventy',
        repo_url: 'git@github.com:org/site.git',
        repo_branch: 'main',
      })
    );
    expect(res.status).toBe(201);
    const data = mockSiteCreate.mock.calls[0][0].data;
    expect(data.repo_url).toBe('git@github.com:org/site.git');
    expect(data.repo_branch).toBe('main');
  });

  it('accepts staging + Bast worker config on create', async () => {
    const res = await POST(
      postReq({
        name: 'Bast Site',
        client_id: CLIENT_ID,
        prod_branch: 'main',
        staging_branch: 'staging',
        bast_enabled: true,
        auto_deploy: false,
      })
    );
    expect(res.status).toBe(201);
    const data = mockSiteCreate.mock.calls[0][0].data;
    expect(data.prod_branch).toBe('main');
    expect(data.bast_enabled).toBe(true);
    expect(data.auto_deploy).toBe(false);
  });
});
