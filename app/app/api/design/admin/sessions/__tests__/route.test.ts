import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, signIn, anonymous, SITE_ID } from '@/lib/design/__tests__/route-test-kit';
import { findForbiddenKeys } from '@/lib/design/projections';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, designSession: { findMany: vi.fn() }, designPublish: { findMany: vi.fn() } } }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const findMany = prisma.designSession.findMany as Mock;
const call = (qs = '') => GET(getRequest(`/api/design/admin/sessions${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{
    id: 's1', status: 'awaiting_input', cost_usd: 3, budget_usd: 25, updated_at: new Date(), last_publish_id: 'p1', publish_requested_at: new Date(),
    publish_precheck: { head_sha: 'h', gates_ok: true, gates: [{ name: 'a11y', ok: true }], files_changed: ['a'], pages_affected: ['/'], copy_words: 9 },
    task: { id: 't1', title: 'Home' }, site: { name: 'VCDP' }, designer: { name: 'Dee' },
  }]);
  (prisma.designPublish.findMany as Mock).mockResolvedValue([{ id: 'p1', status: 'published', finished_at: new Date() }]);
});

describe('GET /api/design/admin/sessions', () => {
  it('admin and pm see the overview with designer, precheck, last publish and timer', async () => {
    for (const role of ['admin', 'pm'] as const) {
      signIn(auth, userFind, role);
      const res = await call();
      expect(res.status).toBe(200);
      const s = (await res.json()).sessions[0];
      expect(s).toMatchObject({ id: 's1', designer: { name: 'Dee' }, site: { name: 'VCDP' }, last_publish: { id: 'p1', status: 'published' }, timer: { running: false, elapsed_s: 0 } });
      expect(s.publish_precheck).toMatchObject({ gates_ok: true });
      expect(s.publish_precheck.copy_words).toBeUndefined();
      expect(findForbiddenKeys(s)).toEqual([]);
    }
  });
  it('filters: status, site_id, publish_requested=true; bad values are 400', async () => {
    signIn(auth, userFind, 'admin');
    await call(`?status=active&site_id=${SITE_ID}&publish_requested=true`);
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'active', site_id: SITE_ID, publish_requested_at: { not: null } });
    expect((await call('?status=zzz')).status).toBe(400);
    expect((await call('?site_id=zzz')).status).toBe(400);
  });
  it('anonymous 401; designer and tech 403; an API key is 403', async () => {
    anonymous(auth);
    expect((await call()).status).toBe(401);
    signIn(auth, userFind, 'designer');
    expect((await call()).status).toBe(403);
    signIn(auth, userFind, 'tech');
    expect((await call()).status).toBe(403);
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call()).status).toBe(403);
  });
});
