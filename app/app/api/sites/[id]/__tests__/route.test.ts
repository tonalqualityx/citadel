import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    site: { update: vi.fn() },
    client: { findUnique: vi.fn() },
    hostingPlan: { findUnique: vi.fn() },
    maintenancePlan: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockSiteUpdate = prisma.site.update as Mock;

function patchReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sites/s1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
const params = Promise.resolve({ id: 's1' });

describe('PATCH /api/sites/[id] — publishing config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
    mockSiteUpdate.mockResolvedValue({ id: 's1', name: 'Site', site_type: 'eleventy' });
  });

  it('accepts and persists Eleventy publishing fields', async () => {
    const res = await PATCH(
      patchReq({
        site_type: 'eleventy',
        repo_url: 'git@github.com:org/site.git',
        repo_branch: 'main',
        content_dir: 'src/posts',
      }),
      { params }
    );
    expect(res.status).toBe(200);
    const data = mockSiteUpdate.mock.calls[0][0].data;
    expect(data.site_type).toBe('eleventy');
    expect(data.repo_url).toBe('git@github.com:org/site.git');
    expect(data.content_dir).toBe('src/posts');
  });

  it('accepts handoff fields and a null site_type (unset)', async () => {
    const res = await PATCH(
      patchReq({ site_type: 'handoff', handoff_method: 'citadel_card', handoff_recipient: 'editor' }),
      { params }
    );
    expect(res.status).toBe(200);
    const data = mockSiteUpdate.mock.calls[0][0].data;
    expect(data.handoff_method).toBe('citadel_card');
  });

  it('rejects an invalid site_type', async () => {
    const res = await PATCH(patchReq({ site_type: 'ghost' }), { params });
    expect(res.status).toBe(400);
    expect(mockSiteUpdate).not.toHaveBeenCalled();
  });
});
