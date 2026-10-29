import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, signIn, anonymous, SITE_ID, ADMIN_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), findMany: vi.fn() }, site: { findMany: vi.fn() }, designPublish: { findMany: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const pubs = prisma.designPublish.findMany as Mock;
const call = (qs = '') => GET(getRequest(`/api/design/admin/publishes${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  pubs.mockResolvedValue([{ id: 'p1', kind: 'publish', status: 'published', site_id: SITE_ID, actor_id: ADMIN_ID, actor_role: 'admin', main_role: 'production', created_at: new Date(), finished_at: new Date(), deploy_url: 'https://x.pages.dev' }]);
  (prisma.site.findMany as Mock).mockResolvedValue([{ id: SITE_ID, name: 'VCDP' }]);
  (prisma.user.findMany as Mock).mockResolvedValue([{ id: ADMIN_ID, name: 'Mike' }]);
});

describe('GET /api/design/admin/publishes', () => {
  it('lists publishes with site, actor and main role (read-only)', async () => {
    signIn(auth, userFind, 'pm');
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).publishes[0]).toMatchObject({ id: 'p1', kind: 'publish', status: 'published', site: { name: 'VCDP' }, actor: { name: 'Mike', role: 'admin' }, main_role: 'production', deploy_url: 'https://x.pages.dev' });
  });
  it('filters by site, status and since; bad values are 400', async () => {
    signIn(auth, userFind, 'admin');
    await call(`?site_id=${SITE_ID}&status=published&since=2026-10-01T00:00:00Z`);
    const where = pubs.mock.calls[0][0].where;
    expect(where).toMatchObject({ site_id: SITE_ID, status: 'published' });
    expect(where.created_at.gte).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect((await call('?site_id=x')).status).toBe(400);
    expect((await call('?status=x')).status).toBe(400);
    expect((await call('?since=notadate')).status).toBe(400);
  });
  it('anonymous 401; designer 403; API key 403', async () => {
    anonymous(auth);
    expect((await call()).status).toBe(401);
    signIn(auth, userFind, 'designer');
    expect((await call()).status).toBe(403);
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call()).status).toBe(403);
  });
});
