import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', async () => ({ prisma: (await import('@/lib/design/__tests__/publish-fake-db')).fakeDb }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { fakeDb } from '@/lib/design/__tests__/publish-fake-db';
import { IDS, authAs, jsonRequest, paramsOf, publishedRow, seedWorld, sessionOf, settingsOf, siteOf, unassign, type Who } from '@/lib/design/__tests__/publish-scenario';

const mockAuth = vi.mocked(requireAuth);
const PUB = '9a000000-0000-4000-8000-000000000001';

function rollback(who: Who, body: unknown = {}, opts: { id?: string; via?: 'session' | 'api_key'; headers?: Record<string, string> } = {}) {
  mockAuth.mockResolvedValue(authAs(who, opts.via) as never);
  const id = opts.id ?? PUB;
  return POST(jsonRequest(`/api/design/publishes/${id}/rollback`, body, opts.headers), paramsOf(id));
}

async function expectCode(res: Response, status: number, code?: string) {
  expect(res.status).toBe(status);
  if (code) expect((await res.json()).code).toBe(code);
}

const rollbacks = () => fakeDb.store.designPublish.filter((p) => p.kind === 'rollback');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorld(fakeDb);
  fakeDb.store.designPublish.push(publishedRow());
});

describe('POST /api/design/publishes/:id/rollback', () => {
  it("the publish's actor, one click: a queued rollback row confirmed now, a rollback command, session publishing", async () => {
    const res = await rollback('designer', { reason: 'client hated it' });
    expect(res.status).toBe(202);
    const { publish_id } = await res.json();
    const [row] = rollbacks();
    expect(row.id).toBe(publish_id);
    expect(row).toMatchObject({
      kind: 'rollback', status: 'queued', rolls_back_id: PUB, actor_id: IDS.designer, actor_role: 'designer', main_role: 'production',
      session_id: IDS.session, site_id: IDS.site, task_id: IDS.task, from_main_sha: 'd'.repeat(40),
    });
    expect(row.confirmed_at).toBeInstanceOf(Date);
    expect((row.confirmation_shown as Record<string, unknown>).rollback_reason).toBe('client hated it');
    const [cmd] = fakeDb.store.designCommand;
    expect(cmd.verb).toBe('rollback');
    expect(cmd.payload).toMatchObject({ publish_id, target_publish_id: PUB, target_result_sha: 'd'.repeat(40), target_from_main_sha: 'c'.repeat(40), main_role: 'production' });
    expect(sessionOf(fakeDb).status).toBe('publishing');
    // the target stays published until the rollback itself is published
    expect(fakeDb.store.designPublish.find((p) => p.id === PUB)!.status).toBe('published');
  });

  it('an admin may roll back any latest publish', async () => {
    expect((await rollback('admin')).status).toBe(202);
    expect(rollbacks()[0].actor_role).toBe('admin');
  });

  it('a non-participant 404; pm 403; tech 404', async () => {
    await expectCode(await rollback('other'), 404);
    await expectCode(await rollback('pm'), 403, 'forbidden');
    await expectCode(await rollback('tech'), 404);
    expect(rollbacks()).toHaveLength(0);
  });

  it('an older publish 409 not_latest', async () => {
    fakeDb.store.designPublish.push(publishedRow({ id: crypto.randomUUID(), result_sha: 'e'.repeat(40), finished_at: new Date(Date.now() + 1000) }));
    await expectCode(await rollback('designer'), 409, 'not_latest');
    expect(rollbacks()).toHaveLength(0);
  });

  it('a publish already rolled back, a failed one, or a rollback row 409', async () => {
    const row = fakeDb.store.designPublish[0];
    row.status = 'rolled_back';
    await expectCode(await rollback('designer'), 409);
    row.status = 'failed';
    await expectCode(await rollback('designer'), 409, 'not_published');
    row.status = 'published';
    row.kind = 'rollback';
    await expectCode(await rollback('designer'), 409, 'not_rollbackable');
  });

  it('something queued or running on the site 409', async () => {
    fakeDb.store.designPublish.push(publishedRow({ id: crypto.randomUUID(), session_id: IDS.session2, status: 'running', finished_at: null }));
    await expectCode(await rollback('designer'), 409, 'publish_in_progress');
  });

  it('an API key 403, cross-site 403, kill switch off 409, unknown id 404, reason over 500 400', async () => {
    await expectCode(await rollback('admin', {}, { via: 'api_key' }), 403, 'session_required');
    await expectCode(await rollback('designer', {}, { headers: { 'sec-fetch-site': 'cross-site' } }), 403);
    await expectCode(await rollback('designer', {}, { id: '9a000000-0000-4000-8000-0000000000ff' }), 404);
    await expectCode(await rollback('designer', { reason: 'x'.repeat(501) }), 400);
    settingsOf(fakeDb).enabled = false;
    await expectCode(await rollback('designer'), 409, 'portal_disabled');
    expect(rollbacks()).toHaveLength(0);
  });

  it('a closed session: the rollback still queues, the session status is left alone', async () => {
    sessionOf(fakeDb).status = 'closed';
    expect((await rollback('designer')).status).toBe(202);
    expect(sessionOf(fakeDb).status).toBe('closed');
  });
});

describe('W8.2 fixes on rollback', () => {
  it('H2: her publish after she was removed from the project: 404, nothing queued', async () => {
    unassign(fakeDb, IDS.designer);
    await expectCode(await rollback('designer'), 404, 'not_found');
    expect(rollbacks()).toHaveLength(0);
  });
  it('H4: her publish after she was demoted to tech: 404, nothing queued', async () => {
    fakeDb.store.user.find((u) => u.id === IDS.designer)!.role = 'tech';
    await expectCode(await rollback('designer'), 404, 'not_found');
    expect(rollbacks()).toHaveLength(0);
  });
  it('N4: designer publish switched off for the site: the designer cannot roll back (403), the admin can', async () => {
    siteOf(fakeDb).designer_publish = false;
    await expectCode(await rollback('designer'), 403, 'designer_publish_off');
    expect(rollbacks()).toHaveLength(0);
    expect((await rollback('admin')).status).toBe(202);
  });
  it('N4: mode off everywhere: the designer cannot roll back (403)', async () => {
    settingsOf(fakeDb).designer_publish_mode = 'off';
    await expectCode(await rollback('designer'), 403, 'designer_publish_off');
  });
  it('N1: a body over 32 KB is 413; N8: an unknown field is 400', async () => {
    expect((await rollback('designer', { reason: 'x'.repeat(33 * 1024) })).status).toBe(413);
    expect((await rollback('designer', { force: true })).status).toBe(400);
    expect(rollbacks()).toHaveLength(0);
  });
});
