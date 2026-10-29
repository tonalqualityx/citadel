import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', async () => ({ prisma: (await import('@/lib/design/__tests__/publish-fake-db')).fakeDb }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { hashConfirmationToken } from '@/lib/design/publish-policy';
import { fakeDb } from '@/lib/design/__tests__/publish-fake-db';
import {
  HEAD, HEAD2, IDS, authAs, greenPrecheck, jsonRequest, paramsOf, publishedRow, seedWorld, sessionOf, settingsOf, siteOf, unassign, type Who,
} from '@/lib/design/__tests__/publish-scenario';

const mockAuth = vi.mocked(requireAuth);

function call(who: Who | null, body: unknown = { head_sha: HEAD }, opts: { via?: 'session' | 'api_key'; headers?: Record<string, string>; session?: string } = {}) {
  if (who) mockAuth.mockResolvedValue(authAs(who, opts.via) as never);
  else mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
  const id = opts.session ?? IDS.session;
  return POST(jsonRequest(`/api/design/sessions/${id}/publish`, body, opts.headers), paramsOf(id));
}

const intents = () => fakeDb.store.designPublish.filter((p) => p.session_id === IDS.session);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorld(fakeDb);
});

describe('POST /api/design/sessions/:id/publish (step 1, intent)', () => {
  it('a designer on a production site with the defaults reaches awaiting_confirmation with production wording', async () => {
    const res = await call('designer');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.confirmation_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.shown.main_role).toBe('production');
    expect(body.shown.target_words).toBe('the LIVE production site at vcdp.org');
    expect(body.shown.heading).toBe('Publish to the live site vcdp.org');
    expect(body.shown.live_url).toBe('https://vcdp.org');
    expect(body.shown.main_branch).toBe('main');
    expect(body.shown.gates.status).toBe('green');
    expect(body.shown.pages_affected).toEqual(['/']);
    expect(body.shown.cost_usd).toBe(1.23);

    const [row] = intents();
    expect(row.id).toBe(body.publish_id);
    expect(row.status).toBe('awaiting_confirmation');
    expect(row.confirmation_token_hash).toBe(hashConfirmationToken(body.confirmation_token));
    expect(row.confirmation_token_hash).not.toBe(body.confirmation_token);
    expect(row.actor_id).toBe(IDS.designer);
    expect(row.actor_role).toBe('designer');
    expect(row.publish_mode).toBe('per_site');
    expect(row.site_designer_publish).toBe(true);
    expect(row.head_sha).toBe(HEAD);
    const ttl = (row.confirmation_expires_at as Date).getTime() - (row.confirm_requested_at as Date).getTime();
    expect(ttl).toBe(10 * 60_000);
    // nothing queued: no command, session unchanged
    expect(fakeDb.store.designCommand).toHaveLength(0);
    expect(sessionOf(fakeDb).status).toBe('awaiting_input');
  });

  it('client_preview wording uses the box-reported live URL', async () => {
    seedWorld(fakeDb, { mainRole: 'client_preview', liveUrl: 'https://vcdp.pages.dev' });
    const body = await (await call('designer')).json();
    expect(body.shown.main_role).toBe('client_preview');
    expect(body.shown.target_words).toBe('the client preview at vcdp.pages.dev');
    expect(body.shown.heading).toBe('Publish to the client preview (vcdp.pages.dev)');
  });

  it('an unknown main_role is production wording', async () => {
    seedWorld(fakeDb, { mainRole: null });
    const body = await (await call('designer')).json();
    expect(body.shown.main_role).toBe('production');
  });

  it('settings.confirmation_ttl_minutes sets the expiry', async () => {
    settingsOf(fakeDb).confirmation_ttl_minutes = 3;
    await call('designer');
    const [row] = intents();
    expect((row.confirmation_expires_at as Date).getTime() - (row.confirm_requested_at as Date).getTime()).toBe(3 * 60_000);
  });

  it('a new intent expires the earlier unconfirmed one for the session', async () => {
    const first = await (await call('designer')).json();
    const second = await (await call('designer')).json();
    const byId = (id: string) => intents().find((p) => p.id === id)!;
    expect(byId(first.publish_id).status).toBe('expired');
    expect(byId(first.publish_id).confirmation_token_hash).toBeNull();
    expect(byId(second.publish_id).status).toBe('awaiting_confirmation');
  });

  it('no content or code policy: code files and a 500-word copy change still reach awaiting_confirmation', async () => {
    const s = sessionOf(fakeDb);
    s.publish_precheck = greenPrecheck(HEAD, {
      files_changed: ['src/assets/js/site.js', 'eleventy.config.js', 'src/_data/csp.json', 'src/about/index.njk', '_redirects'],
      pages_affected: ['/', '/about/'],
    });
    s.diff_summary = { files_changed: 5, insertions: 3000, deletions: 900, files: [] };
    fakeDb.store.designChange.push({ id: crypto.randomUUID(), session_id: IDS.session, decision: 'pending', summary: 'word '.repeat(500).trim(), pages: ['/about/'], files: ['src/about/index.njk'], created_at: new Date() });
    const res = await call('designer');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.shown.files_changed).toContain('src/assets/js/site.js');
    expect(JSON.stringify(body)).not.toMatch(/policy|copy_words/);
    expect(intents()[0].status).toBe('awaiting_confirmation');
  });

  it('an admin may publish even with designer publish off everywhere', async () => {
    settingsOf(fakeDb).designer_publish_mode = 'off';
    const res = await call('admin');
    expect(res.status).toBe(201);
    expect(intents()[0].actor_role).toBe('admin');
  });

  describe('refusals', () => {
    it('anonymous 401', async () => {
      expect((await call(null)).status).toBe(401);
    });

    it('cross-site 403 and a non-JSON content type 415', async () => {
      expect((await call('designer', { head_sha: HEAD }, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
      expect((await call('designer', { head_sha: HEAD }, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
      expect((await call('designer', { head_sha: HEAD }, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
      expect(intents()).toHaveLength(0);
    });

    it('designer on a site an admin turned off 403 designer_publish_off', async () => {
      siteOf(fakeDb).designer_publish = false;
      const res = await call('designer');
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('designer_publish_off');
    });

    it('mode off 403; pre_launch_only on a production site 403', async () => {
      settingsOf(fakeDb).designer_publish_mode = 'off';
      expect((await call('designer')).status).toBe(403);
      settingsOf(fakeDb).designer_publish_mode = 'pre_launch_only';
      expect((await call('designer')).status).toBe(403);
      expect(intents()).toHaveLength(0);
    });

    it('admin through an API key 403 (never by key)', async () => {
      const res = await call('admin', { head_sha: HEAD }, { via: 'api_key' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('session_required');
    });

    it('pm 403', async () => {
      const res = await call('pm');
      expect(res.status).toBe(403);
      expect(intents()).toHaveLength(0);
    });

    it('another designer 404; tech 404; an unknown or malformed id 404', async () => {
      expect((await call('other')).status).toBe(404);
      expect((await call('tech')).status).toBe(404);
      expect((await call('designer', { head_sha: HEAD }, { session: '5e000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
      expect((await call('designer', { head_sha: HEAD }, { session: 'nope' })).status).toBe(404);
    });

    it('a missing or malformed head_sha 400', async () => {
      expect((await call('designer', {})).status).toBe(400);
      expect((await call('designer', { head_sha: 'not a sha' })).status).toBe(400);
    });

    it('a head that moved since the actor looked 409 stale_head', async () => {
      const res = await call('designer', { head_sha: HEAD2 });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('stale_head');
    });

    it('red gates on the head 409 with the gate output', async () => {
      sessionOf(fakeDb).publish_precheck = greenPrecheck(HEAD, { gates_ok: false, gates: [{ name: 'a11y', ok: false, summary: '3 contrast errors' }] });
      const res = await call('designer');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('gates_not_green');
      expect(body.gates).toEqual([{ name: 'a11y', ok: false, summary: '3 contrast errors' }]);
      expect(intents()).toHaveLength(0);
    });

    it('a missing precheck, or one for another head, 409', async () => {
      sessionOf(fakeDb).publish_precheck = null;
      expect((await call('designer')).status).toBe(409);
      sessionOf(fakeDb).publish_precheck = greenPrecheck(HEAD2);
      expect((await call('designer')).status).toBe(409);
    });

    it('a second publish on the site (queued or running) 409 publish_in_progress', async () => {
      fakeDb.store.designPublish.push(publishedRow({ id: crypto.randomUUID(), session_id: IDS.session2, status: 'running' }));
      const res = await call('designer');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('publish_in_progress');
    });

    it('session states: active 409, publishing 409, closed 409, stopped 409', async () => {
      for (const status of ['active', 'publishing', 'closed', 'stopped']) {
        sessionOf(fakeDb).status = status;
        expect((await call('designer')).status).toBe(409);
      }
    });

    it('the kill switch off 409 portal_disabled (a pm still 403)', async () => {
      settingsOf(fakeDb).enabled = false;
      const res = await call('designer');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('portal_disabled');
      expect((await call('pm')).status).toBe(403);
    });
  });
});

describe('W8.2 fixes on the intent', () => {
  it('H2: her own session after she was removed from the project: 404, no intent', async () => {
    unassign(fakeDb, IDS.designer);
    const res = await call('designer');
    expect(res.status).toBe(404);
    expect(intents()).toHaveLength(0);
  });
  it('H2: an admin is not affected by the team', async () => {
    unassign(fakeDb, IDS.designer);
    expect((await call('admin')).status).toBe(201);
  });
  it('N1: a body over 32 KB is 413', async () => {
    expect((await call('designer', { head_sha: HEAD, pad: 'x'.repeat(33 * 1024) })).status).toBe(413);
    expect(intents()).toHaveLength(0);
  });
  it('N8: unknown fields (force, skip_gates) are 400, not dropped', async () => {
    expect((await call('designer', { head_sha: HEAD, force: true })).status).toBe(400);
    expect((await call('designer', { head_sha: HEAD, skip_gates: true })).status).toBe(400);
    expect(intents()).toHaveLength(0);
  });
});
