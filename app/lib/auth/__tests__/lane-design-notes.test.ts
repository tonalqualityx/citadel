import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Design notes lane (portal v2, SPEC 8.1, W1.4): born enforced, exactly 3 routes, and never the design worker or the runner.
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
import { isTrackRunner, requireTrackRunner, isDesignNotesKey, requireDesignNotesKey } from '@/lib/design/runner-kit';
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

const NOTES_ROUTES = [
  'POST /api/clients/7f1c/design-notes',
  'GET /api/clients/7f1c/design-notes',
  'PATCH /api/design-notes/7f1c',
];

describe('lane design-notes', () => {
  it('is always enforced and acts as Bast', () => {
    expect(ALWAYS_ENFORCED_LANES).toContain('design-notes');
    expect(LANE_IDENTITY['design-notes']).toBe('bast');
  });

  it('minting needs scope-mode:enforce (400 without it), and the key carries one lane only', () => {
    expect(keyScopesSchema.safeParse(['lane:design-notes']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:design-notes', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:design-notes', 'lane:design-track', 'scope-mode:enforce']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:design-notes', 'lane:design-worker', 'scope-mode:enforce']).success).toBe(false);
  });

  it('the lane list holds exactly the 3 notes routes', () => {
    expect(LANE_ROUTES['design-notes']).toHaveLength(3);
    for (const rt of NOTES_ROUTES) {
      const [method, path] = rt.split(' ');
      expect(laneAllows('design-notes', method, path)).toBe(true);
    }
  });

  it('refuses everything else: other client routes, tasks, the worker and runner routes, wrong methods (lane list)', () => {
    for (const [m, p] of [
      ['GET', '/api/clients'],
      ['GET', '/api/clients/x'],
      ['PATCH', '/api/clients/x'],
      ['POST', '/api/clients/x/design-notes/extra'],
      ['DELETE', '/api/clients/x/design-notes'],
      ['PUT', '/api/clients/x/design-notes'],
      ['GET', '/api/design-notes/x'],
      ['POST', '/api/design-notes/x'],
      ['DELETE', '/api/design-notes/x'],
      ['GET', '/api/design/worker/inbox'],
      ['PATCH', '/api/design/worker/commands/x'],
      ['GET', '/api/design/runner/candidates'],
      ['POST', '/api/design/runner/claims'],
      ['GET', '/api/design/sessions'],
      ['GET', '/api/tasks'],
      ['POST', '/api/tasks/x/comments'],
      ['GET', '/api/sites'],
    ] as const) {
      expect(laneAllows('design-notes', m, p), `${m} ${p}`).toBe(false);
    }
  });

  it('an enforced notes key on a notes route authenticates as the notes key, not the worker or the runner', async () => {
    findKey.mockResolvedValue(key(['lane:design-notes', 'scope-mode:enforce']));
    request('POST /api/clients/7f1c/design-notes');
    const auth = await requireAuth();
    expect(auth.lane).toBe('design-notes');
    expect(auth.laneEnforced).toBe(true);
    expect(isDesignNotesKey(auth)).toBe(true);
    expect(isDesignWorker(auth)).toBe(false);
    expect(isTrackRunner(auth)).toBe(false);
    await expect(requireDesignNotesKey()).resolves.toMatchObject({ lane: 'design-notes' });
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('a design-notes key fails requireWorker and requireTrackRunner (403), even with the worker email', async () => {
    findKey.mockResolvedValue(key(['lane:design-notes', 'scope-mode:enforce'], WORKER_USER));
    request('GET /api/design/worker/inbox');
    await expect(requireWorker()).rejects.toMatchObject({ statusCode: 403 });
    request('GET /api/design/runner/candidates');
    await expect(requireTrackRunner()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a design-worker key and a design-track key both fail the notes gate (403)', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker', 'scope-mode:enforce'], WORKER_USER));
    request('GET /api/clients/7f1c/design-notes');
    await expect(requireDesignNotesKey()).rejects.toMatchObject({ statusCode: 403 });
    findKey.mockResolvedValue(key(['lane:design-track', 'scope-mode:enforce']));
    request('GET /api/clients/7f1c/design-notes');
    await expect(requireDesignNotesKey()).rejects.toMatchObject({ statusCode: 403 });
    expect(isDesignNotesKey({ lane: 'design-worker', via: 'api_key', laneEnforced: true })).toBe(false);
    expect(isDesignNotesKey({ lane: 'design-track', via: 'api_key', laneEnforced: true })).toBe(false);
  });

  it('enforce: the notes key is refused (403, logged) on worker, runner, designer, task and other client routes', async () => {
    findKey.mockResolvedValue(key(['lane:design-notes', 'scope-mode:enforce']));
    for (const route of [
      'GET /api/design/worker/inbox', 'PATCH /api/design/worker/commands/7f1c', 'POST /api/design/worker/heartbeat',
      'GET /api/design/runner/candidates', 'POST /api/design/runner/claims',
      'GET /api/design/sessions', 'POST /api/design/sessions', 'GET /api/design/sessions/7f1c',
      'GET /api/tasks', 'PATCH /api/tasks/7f1c', 'POST /api/tasks/7f1c/comments',
      'GET /api/clients', 'GET /api/clients/7f1c', 'PATCH /api/clients/7f1c',
    ]) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth(), route).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation).toHaveBeenCalledTimes(1);
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'design-notes', enforced: true });
    }
  });

  // Always enforced: a key planted without the enforce scope is still refused outside the lane, logged as enforced.
  it('a design-notes key planted without scope-mode:enforce is refused outside the lane and is not the notes key', async () => {
    findKey.mockResolvedValue(key(['lane:design-notes']));
    for (const route of ['GET /api/tasks', 'GET /api/clients', 'GET /api/design/worker/inbox']) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'design-notes', enforced: true });
    }
    request('GET /api/clients/7f1c/design-notes');
    const auth = await requireAuth();
    expect(auth.laneEnforced).toBe(false);
    expect(isDesignNotesKey(auth)).toBe(false);
    await expect(requireDesignNotesKey()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a session cookie or a non-lane key is not the notes key', () => {
    expect(isDesignNotesKey({ via: 'session', lane: 'design-notes', laneEnforced: true })).toBe(false);
    expect(isDesignNotesKey({ via: 'api_key', laneEnforced: true })).toBe(false);
    expect(isDesignNotesKey({ via: 'api_key', lane: 'design-notes,bast', laneEnforced: true })).toBe(false);
    expect(isDesignNotesKey(null)).toBe(false);
  });
});
