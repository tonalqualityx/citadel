import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Design worker lane (design D2): enforce vs shadow, checked in authenticateApiKey against x-citadel-route.
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
import { LANE_ROUTES, laneAllows } from '../lane-scopes';

const findKey = prisma.apiKey.findFirst as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const WORKER_USER = { id: 'svc-1', email: DESIGN_WORKER_SERVICE_EMAIL, role: 'tech', is_active: true };

function key(scopes: string[]) {
  return { id: 'key-1', key_prefix: 'citadel_0123abcd', scopes, expires_at: null, is_revoked: false, user: WORKER_USER };
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

describe('lane design-worker', () => {
  it('a worker route with the enforced key authenticates as the worker', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker', 'scope-mode:enforce']));
    request('PATCH /api/design/worker/sessions/7f1c');
    const auth = await requireAuth();
    expect(auth.lane).toBe('design-worker');
    expect(auth.laneEnforced).toBe(true);
    expect(isDesignWorker(auth)).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('enforce: a route outside the lane is 403 and logged', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker', 'scope-mode:enforce']));
    request('GET /api/tasks');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    expect(createViolation).toHaveBeenCalledTimes(1);
  });

  // W8.2 H3: a shadow design-worker key (planted without scope-mode:enforce) never runs in shadow.
  it('a key planted without the enforce scope is refused (403) on staff routes, and logged as enforced', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker']));
    for (const route of ['GET /api/tasks', 'GET /api/clients', 'GET /api/sites', 'POST /api/tasks']) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation).toHaveBeenCalledTimes(1);
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'design-worker', enforced: true });
    }
  });
  it('a key planted without the enforce scope authenticates on a worker route but is not the worker', async () => {
    findKey.mockResolvedValue(key(['lane:design-worker']));
    request('GET /api/design/worker/inbox');
    const auth = await requireAuth();
    expect(auth.laneEnforced).toBe(false);
    expect(isDesignWorker(auth)).toBe(false); // so requireWorker answers 403
  });

  it('the lane list holds exactly the 14 worker routes and nothing else', () => {
    expect(LANE_ROUTES['design-worker']).toHaveLength(14);
    expect(LANE_ROUTES['design-worker'].every((r) => r.pattern.startsWith('/api/design/worker/'))).toBe(true);
    expect(laneAllows('design-worker', 'POST', '/api/design/worker/sessions/x/assets')).toBe(true);
    expect(laneAllows('design-worker', 'POST', '/api/design/worker/publishes')).toBe(false);
    expect(laneAllows('design-worker', 'POST', '/api/design/worker/commands')).toBe(false);
    expect(laneAllows('design-worker', 'POST', '/api/design/sessions')).toBe(false);
    expect(laneAllows('design-worker', 'GET', '/api/design/sessions/x')).toBe(false);
  });
});
