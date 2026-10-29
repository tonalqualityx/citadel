import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', async () => ({ prisma: (await import('@/lib/design/__tests__/publish-fake-db')).fakeDb }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { createPublishIntent } from '@/lib/design/publishes';
import { designActorFrom } from '@/lib/design/helpers';
import { fakeDb } from '@/lib/design/__tests__/publish-fake-db';
import {
  HEAD, HEAD2, IDS, authAs, greenPrecheck, jsonRequest, paramsOf, publishedRow, seedWorld, sessionOf, settingsOf, siteOf, type Who,
} from '@/lib/design/__tests__/publish-scenario';
import { prisma } from '@/lib/db/prisma';

const mockAuth = vi.mocked(requireAuth);

async function intent(who: 'designer' | 'admin' | 'other' = 'designer', opts: { now?: Date; session?: string } = {}) {
  const roles = { designer: 'designer', admin: 'admin', other: 'designer' } as const;
  const actor = designActorFrom({ userId: IDS[who], role: roles[who], via: 'session' });
  return createPublishIntent(actor, opts.session ?? IDS.session, HEAD, { now: opts.now }, prisma);
}

function confirm(who: Who, publishId: string, body: Record<string, unknown>, via: 'session' | 'api_key' = 'session', headers: Record<string, string> = {}) {
  mockAuth.mockResolvedValue(authAs(who, via) as never);
  return POST(jsonRequest(`/api/design/publishes/${publishId}/confirm`, body, headers), paramsOf(publishId));
}

const rowOf = (id: string) => fakeDb.store.designPublish.find((p) => p.id === id)!;

async function expectCode(res: Response, status: number, code?: string) {
  expect(res.status).toBe(status);
  if (code) expect((await res.json()).code).toBe(code);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorld(fakeDb);
});

describe('POST /api/design/publishes/:id/confirm (step 2)', () => {
  it('the actor with the token and the typed main branch: queued, command, session publishing, token consumed', async () => {
    const i = await intent();
    const res = await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ publish_id: i.publish_id });
    const row = rowOf(i.publish_id);
    expect(row.status).toBe('queued');
    expect(row.confirmed_at).toBeInstanceOf(Date);
    expect(row.confirmation_typed).toBe('main');
    expect(row.confirmation_token_hash).toBeNull();
    expect(fakeDb.store.designCommand).toHaveLength(1);
    const cmd = fakeDb.store.designCommand[0];
    expect(cmd.verb).toBe('publish');
    expect(cmd.session_id).toBe(IDS.session);
    expect(cmd.created_by_id).toBe(IDS.designer);
    expect(cmd.payload).toMatchObject({ publish_id: i.publish_id, head_sha: HEAD, main_role: 'production', live_url: 'https://vcdp.org', main_branch: 'main', actor_role: 'designer', publish_mode: 'per_site', site_designer_publish: true });
    expect(sessionOf(fakeDb).status).toBe('publishing');
  });

  it('typed text is trimmed', async () => {
    const i = await intent();
    expect((await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: '  main ' })).status).toBe(202);
  });

  it('a paused_budget session may publish; it stays paused_budget (no such move in the 8.7 table)', async () => {
    sessionOf(fakeDb).status = 'paused_budget';
    const i = await intent();
    expect((await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' })).status).toBe(202);
    expect(rowOf(i.publish_id).status).toBe('queued');
    expect(sessionOf(fakeDb).status).toBe('paused_budget');
  });

  describe('refusals', () => {
    it('missing token or typed text 400', async () => {
      const i = await intent();
      await expectCode(await confirm('designer', i.publish_id, { typed_confirmation: 'main' }), 400, 'confirmation_missing');
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token }), 400, 'confirmation_missing');
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: '  ', typed_confirmation: 'main' }), 400, 'confirmation_missing');
      expect(rowOf(i.publish_id).status).toBe('awaiting_confirmation');
    });

    it('a wrong token 409', async () => {
      const i = await intent();
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: 'x'.repeat(43), typed_confirmation: 'main' }), 409, 'confirmation_invalid');
      expect(fakeDb.store.designCommand).toHaveLength(0);
    });

    it('a reused token 409', async () => {
      const i = await intent();
      const body = { confirmation_token: i.confirmation_token, typed_confirmation: 'main' };
      expect((await confirm('designer', i.publish_id, body)).status).toBe(202);
      await expectCode(await confirm('designer', i.publish_id, body), 409, 'confirmation_used');
      expect(fakeDb.store.designCommand).toHaveLength(1);
    });

    it('an expired token 409 (and the row becomes expired)', async () => {
      const i = await intent('designer', { now: new Date(Date.now() - 11 * 60_000) });
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'confirmation_expired');
      expect(rowOf(i.publish_id).status).toBe('expired');
    });

    it('a superseded intent 409', async () => {
      const first = await intent();
      await intent();
      await expectCode(await confirm('designer', first.publish_id, { confirmation_token: first.confirmation_token, typed_confirmation: 'main' }), 409, 'confirmation_used');
    });

    it("a foreign token (another publish's) 409", async () => {
      const mine = await intent();
      const theirs = await intent('other', { session: IDS.session2 });
      await expectCode(await confirm('designer', mine.publish_id, { confirmation_token: theirs.confirmation_token, typed_confirmation: 'main' }), 409, 'confirmation_invalid');
    });

    it('typed master for main 409; case-sensitive', async () => {
      const i = await intent();
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'master' }), 409, 'typed_mismatch');
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'Main' }), 409, 'typed_mismatch');
      expect(rowOf(i.publish_id).status).toBe('awaiting_confirmation');
    });

    it('head moved between the steps 409', async () => {
      const i = await intent();
      const s = sessionOf(fakeDb);
      s.head_sha = HEAD2;
      s.publish_precheck = greenPrecheck(HEAD2);
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'stale_head');
    });

    it('gates turned red between the steps 409', async () => {
      const i = await intent();
      sessionOf(fakeDb).publish_precheck = greenPrecheck(HEAD, { gates_ok: false });
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'gates_not_green');
    });

    it('main_role flipped between the steps 409', async () => {
      const i = await intent();
      fakeDb.store.designWorkerState[0].site_main_roles = { [IDS.site]: 'client_preview' };
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'main_role_changed');
    });

    it('the live URL changed between the steps 409', async () => {
      const i = await intent();
      fakeDb.store.designWorkerState[0].site_live_urls = { [IDS.site]: 'https://new.vcdp.org' };
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'main_role_changed');
    });

    it('another user confirming 404 (another designer, an admin who is not the actor, a pm)', async () => {
      const i = await intent();
      const body = { confirmation_token: i.confirmation_token, typed_confirmation: 'main' };
      await expectCode(await confirm('other', i.publish_id, body), 404);
      await expectCode(await confirm('admin', i.publish_id, body), 404);
      await expectCode(await confirm('pm', i.publish_id, body), 404);
      expect(rowOf(i.publish_id).status).toBe('awaiting_confirmation');
    });

    it('the actor through an API key 403; cross-site 403', async () => {
      const i = await intent('admin');
      const body = { confirmation_token: i.confirmation_token, typed_confirmation: 'main' };
      await expectCode(await confirm('admin', i.publish_id, body, 'api_key'), 403, 'session_required');
      await expectCode(await confirm('admin', i.publish_id, body, 'session', { 'sec-fetch-site': 'cross-site' }), 403);
      expect(rowOf(i.publish_id).status).toBe('awaiting_confirmation');
    });

    it('an unknown id 404', async () => {
      await expectCode(await confirm('designer', '9a000000-0000-4000-8000-0000000000ff', { confirmation_token: 'x', typed_confirmation: 'main' }), 404);
    });

    it('a second publish on the site queued meanwhile 409 publish_in_progress', async () => {
      const i = await intent();
      fakeDb.store.designPublish.push(publishedRow({ id: crypto.randomUUID(), session_id: IDS.session2, status: 'queued' }));
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 409, 'publish_in_progress');
      expect(rowOf(i.publish_id).status).toBe('awaiting_confirmation');
      expect(fakeDb.store.designCommand).toHaveLength(0);
    });

    it('an admin switched designer publish off between the steps 403', async () => {
      const i = await intent();
      siteOf(fakeDb).designer_publish = false;
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 403, 'designer_publish_off');
      siteOf(fakeDb).designer_publish = true;
      settingsOf(fakeDb).designer_publish_mode = 'off';
      await expectCode(await confirm('designer', i.publish_id, { confirmation_token: i.confirmation_token, typed_confirmation: 'main' }), 403, 'designer_publish_off');
    });

    it('a rollback row cannot be confirmed (404)', async () => {
      fakeDb.store.designPublish.push(publishedRow({ id: '9a000000-0000-4000-8000-000000000009', kind: 'rollback', status: 'queued' }));
      await expectCode(await confirm('designer', '9a000000-0000-4000-8000-000000000009', { confirmation_token: 'x', typed_confirmation: 'main' }), 404);
    });
  });
});
