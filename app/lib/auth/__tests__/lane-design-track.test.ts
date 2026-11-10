import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Design track lane (portal v2, SPEC 6.1a): born enforced, exactly 12 runner routes, and never the design worker.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/auth/jwt', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
    apiKeyViolation: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '../middleware';
import { resetKeyViolationThrottle } from '../key-violations';
import { isDesignWorker, DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import { requireWorker } from '@/lib/design/worker-kit';
import { isTrackRunner, requireTrackRunner } from '@/lib/design/runner-kit';
import { ALWAYS_ENFORCED_LANES, LANE_IDENTITY, LANE_ROUTES, laneAllows } from '../lane-scopes';
import { keyScopesSchema } from '../key-scopes';

const findKey = prisma.apiKey.findFirst as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const BAST_USER = { id: 'bast-1', email: 'bast@becomeindelible.com', role: 'pm', is_active: true };
const WORKER_USER = { id: 'svc-1', email: DESIGN_WORKER_SERVICE_EMAIL, role: 'tech', is_active: true };

function key(scopes: string[], user = BAST_USER) {
  return { id: 'key-1', key_prefix: 'citadel_0123abcd', scopes, expires_at: null, is_revoked: false, user };
}
function request(route: string) {
  const map: Record<string, string> = { authorization: 'Bearer citadel_fake_test_key', 'x-citadel-route': route };
  (headers as Mock).mockResolvedValue({ get: (n: string) => map[n.toLowerCase()] ?? null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyViolationThrottle();
  (cookies as Mock).mockResolvedValue({ get: () => undefined });
  (prisma.apiKey.update as Mock).mockResolvedValue({});
  createViolation.mockResolvedValue({});
  (prisma.apiKeyViolation.deleteMany as Mock).mockResolvedValue({ count: 0 });
});

const RUNNER_ROUTES = [
  'GET /api/design/runner/candidates',
  'POST /api/design/runner/tracks',
  'GET /api/design/runner/tracks/7f1c',
  'POST /api/design/runner/claims',
  'PATCH /api/design/runner/jobs/7f1c',
  'POST /api/design/runner/tracks/7f1c/assets',
  'GET /api/design/runner/tracks/7f1c/assets/9a2b',
  'PATCH /api/design/runner/tracks/7f1c/assets/9a2b',
  'POST /api/design/runner/tracks/7f1c/references',
  'PATCH /api/design/runner/references/7f1c',
  'POST /api/design/runner/tracks/7f1c/briefs',
  'POST /api/design/runner/tracks/7f1c/adopt',
  'POST /api/design/runner/tracks/7f1c/imports',
];

describe('lane design-track', () => {
  it('is always enforced and acts as Bast', () => {
    expect(ALWAYS_ENFORCED_LANES).toContain('design-track');
    expect(LANE_IDENTITY['design-track']).toBe('bast');
  });

  it('minting needs scope-mode:enforce (400 without it), and the key carries one lane only', () => {
    expect(keyScopesSchema.safeParse(['lane:design-track']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:design-track', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:design-track', 'lane:design-worker', 'scope-mode:enforce']).success).toBe(false);
  });

  it('the lane list holds exactly the 13 runner routes, all under /api/design/runner/', () => {
    expect(LANE_ROUTES['design-track']).toHaveLength(13);
    expect(LANE_ROUTES['design-track'].every((r) => r.pattern.startsWith('/api/design/runner/'))).toBe(true);
    for (const rt of RUNNER_ROUTES) {
      const [method, path] = rt.split(' ');
      expect(laneAllows('design-track', method, path)).toBe(true);
    }
  });

  it('refuses the worker routes, the designer routes, tasks, and the wrong methods (lane list)', () => {
    for (const [m, p] of [
      ['GET', '/api/design/worker/inbox'],
      ['PATCH', '/api/design/worker/commands/x'],
      ['POST', '/api/design/worker/sessions/x/assets'],
      ['GET', '/api/design/sessions'],
      ['POST', '/api/design/sessions'],
      ['GET', '/api/design/sessions/x'],
      ['POST', '/api/design/sessions/x/home-ready'],
      ['GET', '/api/tasks'],
      ['PATCH', '/api/tasks/x'],
      ['POST', '/api/tasks/x/comments'],
      ['GET', '/api/sites'],
      ['DELETE', '/api/design/runner/jobs/x'],
      ['GET', '/api/design/runner/claims'],
      ['POST', '/api/design/runner/candidates'],
    ] as const) {
      expect(laneAllows('design-track', m, p), `${m} ${p}`).toBe(false);
    }
  });

  it('an enforced runner key on a runner route authenticates as the runner, not the worker', async () => {
    findKey.mockResolvedValue(key(['lane:design-track', 'scope-mode:enforce']));
    request('POST /api/design/runner/claims');
    const auth = await requireAuth();
    expect(auth.lane).toBe('design-track');
    expect(auth.laneEnforced).toBe(true);
    expect(isTrackRunner(auth)).toBe(true);
    expect(isDesignWorker(auth)).toBe(false);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('requireTrackRunner admits the runner key; requireWorker refuses it (403)', async () => {
    findKey.mockResolvedValue(key(['lane:design-track', 'scope-mode:enforce']));
    request('GET /api/design/runner/candidates');
    await expect(requireTrackRunner()).resolves.toMatchObject({ lane: 'design-track' });
    request('GET /api/design/worker/inbox');
    // the lane refuses the worker route before the handler runs (enforced), and requireWorker would refuse it anyway
    await expect(requireWorker()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a design-worker key fails requireTrackRunner (403), even with the worker email and enforce', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker', 'scope-mode:enforce'], WORKER_USER));
    request('GET /api/design/runner/candidates');
    // the worker lane does not list the runner route: refused at the key gate; and the kit alone refuses it too
    await expect(requireTrackRunner()).rejects.toMatchObject({ statusCode: 403 });
    expect(isTrackRunner({ lane: 'design-worker', via: 'api_key', laneEnforced: true })).toBe(false);
  });

  it('enforce: the runner key is refused (403, logged) on /api/design/worker/*, /api/design/sessions* and /api/tasks*', async () => {
    findKey.mockResolvedValue(key(['lane:design-track', 'scope-mode:enforce']));
    for (const route of [
      'GET /api/design/worker/inbox', 'PATCH /api/design/worker/commands/7f1c', 'POST /api/design/worker/heartbeat',
      'GET /api/design/sessions', 'POST /api/design/sessions', 'GET /api/design/sessions/7f1c', 'POST /api/design/sessions/7f1c/home-ready',
      'GET /api/tasks', 'PATCH /api/tasks/7f1c', 'POST /api/tasks/7f1c/comments', 'GET /api/tasks/7f1c',
    ]) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth(), route).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation).toHaveBeenCalledTimes(1);
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'design-track', enforced: true });
    }
  });

  // Always enforced: a key planted without the enforce scope is still refused outside the lane, logged as enforced.
  it('a design-track key planted without scope-mode:enforce is refused outside the lane and is not the runner', async () => {
    findKey.mockResolvedValue(key(['lane:design-track']));
    for (const route of ['GET /api/tasks', 'POST /api/design/sessions', 'GET /api/design/worker/inbox']) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'design-track', enforced: true });
    }
    request('GET /api/design/runner/candidates');
    const auth = await requireAuth();
    expect(auth.laneEnforced).toBe(false);
    expect(isTrackRunner(auth)).toBe(false);
    await expect(requireTrackRunner()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a design-notes key fails requireTrackRunner (403), even enforced', async () => {
    findKey.mockResolvedValue(key(['lane:design-notes', 'scope-mode:enforce']));
    request('GET /api/design/runner/candidates');
    await expect(requireTrackRunner()).rejects.toMatchObject({ statusCode: 403 });
    expect(isTrackRunner({ lane: 'design-notes', via: 'api_key', laneEnforced: true })).toBe(false);
  });

  it('a session cookie or a non-lane key is not the runner', () => {
    expect(isTrackRunner({ via: 'session', lane: 'design-track', laneEnforced: true })).toBe(false);
    expect(isTrackRunner({ via: 'api_key', laneEnforced: true })).toBe(false);
    expect(isTrackRunner({ via: 'api_key', lane: 'design-track,bast', laneEnforced: true })).toBe(false);
    expect(isTrackRunner(null)).toBe(false);
  });
});
