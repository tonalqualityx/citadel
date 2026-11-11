// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../__tests__/harness';

const h = vi.hoisted(() => ({ ownerId: '3ecfb7be-0000-4000-8000-000000000001' as string | null }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/bast-chat/route-helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/route-helpers')>()),
  workerOwnerId: vi.fn(async () => {
    if (!h.ownerId) {
      const { ApiError } = await import('@/lib/api/errors');
      throw new ApiError('Chat not found', 404, 'not_found');
    }
    return h.ownerId;
  }),
}));
vi.mock('@/lib/home/emergency/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/emergency/store')>()),
  watchPlan: vi.fn(),
  applyWatch: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { applyWatch, watchPlan } from '@/lib/home/emergency/store';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/home-watch';
const SITE = '11111111-1111-4111-8111-111111111111';
const plan = { dry_run: true as const, checks: [{ key: `site:${SITE}`, site_id: SITE, domain: 'jillscafe.com' }], open: [] };
const done = { lines: [], counts: { opened: 1, updated: 0, closed: 0, ignored: 0 } };
const goodBody = {
  kuma: [{ monitor: 'Jills', domain: 'jillscafe.com', client_id: null, started: '2026-11-11T14:00:00Z', escalated: true }],
  checks: [{ key: `site:${SITE}`, up: false, summary: 'no answer', checked_at: '2026-11-11T15:00:00Z' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(watchPlan).mockResolvedValue(plan);
  vi.mocked(applyWatch).mockResolvedValue(done);
});

const callers: [string, () => Promise<Response>][] = [
  ['GET', () => GET()],
  ['POST', () => POST(req('POST', PATH, goodBody) as never)],
];

describe('home-watch route: who may call', () => {
  for (const [name, call] of callers) {
    it(`${name}: 401 when signed out`, async () => {
      vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
      const res = await call();
      expect(res.status).toBe(401);
      expect(Object.keys(await res.json())).toEqual(['error']);
      expect(watchPlan).not.toHaveBeenCalled();
      expect(applyWatch).not.toHaveBeenCalled();
    });
    for (const [who, auth] of NOT_WORKERS) {
      it(`${name}: 403 for ${who}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(auth);
        expect((await call()).status).toBe(403);
        expect(watchPlan).not.toHaveBeenCalled();
        expect(applyWatch).not.toHaveBeenCalled();
      });
    }
    it(`${name}: 404 when no chat owner is configured`, async () => {
      h.ownerId = null;
      expect((await call()).status).toBe(404);
      expect(watchPlan).not.toHaveBeenCalled();
      expect(applyWatch).not.toHaveBeenCalled();
    });
  }
});

describe('home-watch route: GET', () => {
  it('is a dry run for the configured owner, no-store, and takes no user id', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(plan);
    expect(vi.mocked(watchPlan).mock.calls[0][1]).toBe(OWNER_ID);
    expect(applyWatch).not.toHaveBeenCalled();
  });
  it('answers skipped home_off as given', async () => {
    vi.mocked(watchPlan).mockResolvedValue({ dry_run: true, skipped: 'home_off', checks: [], open: [] });
    expect(await (await GET()).json()).toEqual({ dry_run: true, skipped: 'home_off', checks: [], open: [] });
  });
});

describe('home-watch route: POST', () => {
  it('applies the report for the owner, no-store', async () => {
    const res = await POST(req('POST', PATH, goodBody) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(done);
    const [, owner, body] = vi.mocked(applyWatch).mock.calls[0];
    expect(owner).toBe(OWNER_ID);
    expect(body.kuma).toHaveLength(1);
    expect(body.checks[0].up).toBe(false);
    expect(body.checks[0].checked_at).toBeInstanceOf(Date);
  });
  it('kuma null passes through as null (the store closes nothing then)', async () => {
    await POST(req('POST', PATH, { kuma: null, checks: [] }) as never);
    expect(vi.mocked(applyWatch).mock.calls[0][2].kuma).toBeNull();
  });
  it('a missing kuma reads as null, and a missing checks as none', async () => {
    await POST(req('POST', PATH, {}) as never);
    const b = vi.mocked(applyWatch).mock.calls[0][2];
    expect(b.kuma).toBeNull();
    expect(b.checks).toEqual([]);
  });
  it('answers home_off as given', async () => {
    vi.mocked(applyWatch).mockResolvedValue({ lines: [], skipped: 'home_off', counts: { opened: 0, updated: 0, closed: 0, ignored: 0 } });
    expect((await (await POST(req('POST', PATH, goodBody) as never)).json()).skipped).toBe('home_off');
  });
  it('400 for an unknown field, a user id, a bad shape and non-JSON; nothing runs', async () => {
    for (const body of [{ user_id: OWNER_ID }, { kuma: [{ domain: 'a.com' }] }, { checks: [{ key: 'x', up: 'yes', checked_at: 'now' }] }, { kuma: 'no' }, { checks: [{ key: 'x', up: true, checked_at: 'not a date' }] }]) {
      expect((await POST(req('POST', PATH, body) as never)).status).toBe(400);
    }
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(applyWatch).not.toHaveBeenCalled();
  });
  it('caps the lists and the body size', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ monitor: 'm', domain: `a${i}.com`, started: '2026-11-11T14:00:00Z' }));
    expect((await POST(req('POST', PATH, { kuma: many }) as never)).status).toBe(400);
    const checks = Array.from({ length: 101 }, () => ({ key: `site:${SITE}`, up: true, checked_at: '2026-11-11T15:00:00Z' }));
    expect((await POST(req('POST', PATH, { checks }) as never)).status).toBe(400);
    const big = { kuma: null, checks: [], pad: 'x'.repeat(70 * 1024) };
    expect((await POST(req('POST', PATH, big) as never)).status).toBe(413);
    expect(applyWatch).not.toHaveBeenCalled();
  });
  it('accepts an epoch-seconds start', async () => {
    await POST(req('POST', PATH, { kuma: [{ monitor: 'm', domain: 'a.com', started: 1794409200 }] }) as never);
    expect(vi.mocked(applyWatch).mock.calls[0][2].kuma![0].started.toISOString()).toBe('2026-11-11T15:00:00.000Z');
  });
});
