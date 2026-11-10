// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';
import { SCRATCH } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import * as candidates from '../candidates/route';
import * as tracks from '../tracks/route';
import * as track from '../tracks/[id]/route';
import * as claims from '../claims/route';
import * as job from '../jobs/[id]/route';
import * as assets from '../tracks/[id]/assets/route';
import * as asset from '../tracks/[id]/assets/[assetId]/route';
import * as refs from '../tracks/[id]/references/route';
import * as ref from '../references/[id]/route';
import * as briefs from '../tracks/[id]/briefs/route';
import * as adopt from '../tracks/[id]/adopt/route';
import * as imports from '../tracks/[id]/imports/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ID = '3f2b8c1e-0000-4000-8000-000000000001';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const rows: Array<{ route: string; handler: Handler; path: string; method: string; params: Record<string, string> }> = [
  { route: 'GET /api/design/runner/candidates', handler: candidates.GET as never, path: '/candidates', method: 'GET', params: {} },
  { route: 'POST /api/design/runner/tracks', handler: tracks.POST as never, path: '/tracks', method: 'POST', params: {} },
  { route: 'GET /api/design/runner/tracks/:id', handler: track.GET as never, path: `/tracks/${ID}`, method: 'GET', params: { id: ID } },
  { route: 'POST /api/design/runner/claims', handler: claims.POST as never, path: '/claims', method: 'POST', params: {} },
  { route: 'PATCH /api/design/runner/jobs/:id', handler: job.PATCH as never, path: `/jobs/${ID}`, method: 'PATCH', params: { id: ID } },
  { route: 'POST /api/design/runner/tracks/:id/assets', handler: assets.POST as never, path: `/tracks/${ID}/assets`, method: 'POST', params: { id: ID } },
  { route: 'GET /api/design/runner/tracks/:id/assets/:assetId', handler: asset.GET as never, path: `/tracks/${ID}/assets/${ID}`, method: 'GET', params: { id: ID, assetId: ID } },
  { route: 'PATCH /api/design/runner/tracks/:id/assets/:assetId', handler: asset.PATCH as never, path: `/tracks/${ID}/assets/${ID}`, method: 'PATCH', params: { id: ID, assetId: ID } },
  { route: 'POST /api/design/runner/tracks/:id/references', handler: refs.POST as never, path: `/tracks/${ID}/references`, method: 'POST', params: { id: ID } },
  { route: 'PATCH /api/design/runner/references/:id', handler: ref.PATCH as never, path: `/references/${ID}`, method: 'PATCH', params: { id: ID } },
  { route: 'POST /api/design/runner/tracks/:id/briefs', handler: briefs.POST as never, path: `/tracks/${ID}/briefs`, method: 'POST', params: { id: ID } },
  { route: 'POST /api/design/runner/tracks/:id/adopt', handler: adopt.POST as never, path: `/tracks/${ID}/adopt`, method: 'POST', params: { id: ID } },
  { route: 'POST /api/design/runner/tracks/:id/imports', handler: imports.POST as never, path: `/tracks/${ID}/imports`, method: 'POST', params: { id: ID } },
];

const RUNNER = { userId: ID, email: 'bast@example.test', role: 'pm', via: 'api_key', apiKeyId: 'k1', lane: 'design-track', laneEnforced: true };
const NOT_RUNNERS: Array<[string, Record<string, unknown>]> = [
  ['the design worker key', { ...RUNNER, email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'design-worker' }],
  ['an admin session', { ...RUNNER, via: 'session', apiKeyId: undefined, lane: undefined, role: 'admin' }],
  ['an admin key with no lane', { ...RUNNER, lane: undefined, laneEnforced: undefined, role: 'admin' }],
  ['a design-track key without enforce (shadow)', { ...RUNNER, laneEnforced: false }],
  ['a session cookie for the runner user', { ...RUNNER, via: 'session', apiKeyId: undefined }],
  ['another lane key', { ...RUNNER, lane: 'bast' }],
];

const call = (r: (typeof rows)[number]) =>
  r.handler(
    new NextRequest(`http://localhost:3000/api/design/runner${r.path}`, { method: r.method, ...(r.method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }) }),
    { params: Promise.resolve(r.params) },
  );

describe('design-track runner routes: auth matrix', () => {
  it('has a handler row for every lane route and no other', () => {
    expect(rows.map((r) => r.route).sort()).toEqual(LANE_ROUTES['design-track'].map((r) => `${r.method} ${r.pattern}`).sort());
    expect(rows).toHaveLength(13);
  });

  it.each(rows.map((r) => [r.route, r] as const))('%s: anonymous is 401', async (_n, r) => {
    as.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await call(r)).status).toBe(401);
  });

  for (const [who, auth] of NOT_RUNNERS) {
    it.each(rows.map((r) => [r.route, r] as const))(`%s: ${who} is 403`, async (_n, r) => {
      as.mockResolvedValue(auth);
      expect((await call(r)).status).toBe(403);
    });
  }

  it('no runner route is reachable through the session identity: a designer session is refused on all 13', async () => {
    as.mockResolvedValue({ userId: ID, email: 'd@example.test', role: 'designer', via: 'session' });
    for (const r of rows) expect((await call(r)).status, r.route).toBe(403);
  });

  it.skipIf(!SCRATCH).each(rows.map((r) => [r.route, r] as const))('%s: the enforced runner key passes the gate', async (_n, r) => {
    as.mockResolvedValue(RUNNER);
    const status = (await call(r)).status;
    expect([401, 403]).not.toContain(status);
  });
});
