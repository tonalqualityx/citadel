import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', async () => ({ prisma: (await import('@/lib/design/__tests__/publish-fake-db')).fakeDb }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { GET } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { findForbiddenKeys } from '@/lib/design/projections';
import { fakeDb } from '@/lib/design/__tests__/publish-fake-db';
import { IDS, authAs, paramsOf, publishedRow, seedWorld, type Who } from '@/lib/design/__tests__/publish-scenario';

const mockAuth = vi.mocked(requireAuth);
const PUB = '9a000000-0000-4000-8000-000000000001';

function get(who: Who | null, id = PUB) {
  if (who) mockAuth.mockResolvedValue(authAs(who) as never);
  else mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
  return GET(new Request(`http://localhost:3000/api/design/publishes/${id}`), paramsOf(id));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorld(fakeDb);
  fakeDb.store.designPublish.push(publishedRow({ confirmation_token_hash: 'f'.repeat(64), policy: { copy_words: 9 } }));
  fakeDb.store.designChange.push({
    id: crypto.randomUUID(), session_id: IDS.session, summary: 'Hero copy', data_libs: ['hero'], pages: ['/'], before_asset_ids: [], after_asset_ids: [],
    decision: 'accepted', created_at: new Date(Date.now() - 60_000),
  });
});

describe('GET /api/design/publishes/:id', () => {
  it('the session designer sees the full projection and may roll back the latest', async () => {
    const res = await get('designer');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publish.id).toBe(PUB);
    expect(body.publish.confirmation_shown.target_words).toBe('the LIVE production site at vcdp.org');
    expect(body.publish.confirmation_typed).toBe('main');
    expect(body.session).toEqual({ id: IDS.session, task: { id: IDS.task, title: 'Home hero refresh' }, designer: { name: 'designer name' } });
    expect(body.changes).toHaveLength(1);
    expect(body.can_rollback).toBe(true);
    expect(findForbiddenKeys(body)).toEqual([]);
  });

  it('admin 200 (can roll back); pm 200 (cannot: forbidden)', async () => {
    expect((await (await get('admin')).json()).can_rollback).toBe(true);
    const pm = await (await get('pm')).json();
    expect(pm.can_rollback).toBe(false);
    expect(pm.rollback_reason).toBe('forbidden');
  });

  it('not the latest: can_rollback false with not_latest', async () => {
    fakeDb.store.designPublish.push(publishedRow({ id: crypto.randomUUID(), result_sha: 'e'.repeat(40), finished_at: new Date(Date.now() + 1000) }));
    const body = await (await get('designer')).json();
    expect(body.can_rollback).toBe(false);
    expect(body.rollback_reason).toBe('not_latest');
  });

  it('another designer 404, tech 404, unknown and malformed ids 404, anonymous 401', async () => {
    expect((await get('other')).status).toBe(404);
    expect((await get('tech')).status).toBe(404);
    expect((await get('admin', '9a000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await get('admin', 'nope')).status).toBe(404);
    expect((await get(null)).status).toBe(401);
  });
});
