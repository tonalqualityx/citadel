import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, signIn, anonymous } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/work', () => ({ loadStartSites: vi.fn(async () => [{ id: 's1', name: 'VCDP' }]) }));
vi.mock('@/lib/design/access', async (orig) => ({ ...(await orig<typeof import('@/lib/design/access')>()), loadDrawer: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadDrawer } from '@/lib/design/access';
import { loadStartSites } from '@/lib/design/work';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const drawer = loadDrawer as Mock;

const site = { id: 's1', name: 'VCDP', site_type: 'eleventy', design_portal_enabled: true, is_deleted: false };
beforeEach(() => {
  vi.clearAllMocks();
  drawer.mockResolvedValue({
    rows: [{
      available: true, site,
      task: { id: 't1', title: 'Home', status: 'not_started', is_deleted: false, sort_order: 1, phase: 'Build', project_phase: null, site_id: null, site: null, project_id: 'p1',
        project: { id: 'p1', name: 'Site', status: 'in_progress', is_deleted: false, site_id: 's1', site }, claim_holder: null, lease_until: null },
    }],
    sessionsByTask: new Map(), publishedAt: new Map(), worker: { last_heartbeat_at: new Date(), paused: false },
  });
});

describe('GET /api/design/tasks', () => {
  it('returns the drawer projection for a designer', async () => {
    signIn(auth, userFind, 'designer');
    const res = await GET(getRequest('/api/design/tasks'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.projects[0]).toMatchObject({ id: 'p1', site: { id: 's1', name: 'VCDP', available: true } });
    expect(json.projects[0].phases[0].tasks[0]).toMatchObject({ id: 't1', title: 'Home', session: null });
    expect(json.worker).toEqual({ online: true, paused: false });
    expect(json.start_sites).toEqual([{ id: 's1', name: 'VCDP' }]);
    expect(loadStartSites).toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toMatch(/estimated|billing|assignee|description/);
  });
  it('passes ?project_id through and rejects a malformed one', async () => {
    signIn(auth, userFind, 'admin');
    const pid = '11111111-1111-4111-8111-111111111111';
    expect((await GET(getRequest(`/api/design/tasks?project_id=${pid}`))).status).toBe(200);
    expect(drawer).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), { projectId: pid });
    expect((await GET(getRequest('/api/design/tasks?project_id=nope'))).status).toBe(400);
  });
  it('pm can read', async () => {
    signIn(auth, userFind, 'pm');
    expect((await GET(getRequest('/api/design/tasks'))).status).toBe(200);
  });
  it('anonymous is 401', async () => {
    anonymous(auth);
    expect((await GET(getRequest('/api/design/tasks'))).status).toBe(401);
  });
  it('a tech user is 403 (the loader refuses)', async () => {
    signIn(auth, userFind, 'tech');
    const { ApiError } = await import('@/lib/api/errors');
    drawer.mockRejectedValue(new ApiError('Forbidden', 403, 'forbidden'));
    expect((await GET(getRequest('/api/design/tasks'))).status).toBe(403);
  });
});
