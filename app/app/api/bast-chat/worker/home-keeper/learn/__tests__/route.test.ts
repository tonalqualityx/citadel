// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../../__tests__/harness';

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
vi.mock('@/lib/home/learn/run', () => ({ runLearn: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { runLearn } from '@/lib/home/learn/run';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { bastChatEndpoints } from '@/lib/api/registry/bast-chat';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/home-keeper/learn';
const daily = { date: '2026-11-17', open_items: 12, past_day: 1, owed: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(runLearn).mockResolvedValue({ dry_run: true, date: '2026-11-17', monday: false, daily, week: null, lines: [], action_ids: [] });
});

const callers: [string, () => Promise<Response>][] = [
  ['GET', () => GET()],
  ['POST', () => POST(req('POST', PATH, {}) as never)],
];

describe('learn route: who may call', () => {
  for (const [name, call] of callers) {
    it(`${name}: 401 when signed out`, async () => {
      vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
      const res = await call();
      expect(res.status).toBe(401);
      expect(Object.keys(await res.json())).toEqual(['error']);
      expect(runLearn).not.toHaveBeenCalled();
    });
    for (const [who, auth] of NOT_WORKERS) {
      it(`${name}: 403 for ${who}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(auth);
        expect((await call()).status).toBe(403);
        expect(runLearn).not.toHaveBeenCalled();
      });
    }
    it(`${name}: 404 when no chat owner is configured`, async () => {
      h.ownerId = null;
      expect((await call()).status).toBe(404);
      expect(runLearn).not.toHaveBeenCalled();
    });
  }
});

describe('learn route: GET', () => {
  it('is a dry run for the configured owner, no-store, and takes no user id', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(runLearn).toHaveBeenCalledTimes(1);
    const [db, owner, now, opts] = vi.mocked(runLearn).mock.calls[0];
    expect((db as unknown as { __marker: string }).__marker).toBe('prisma');
    expect(owner).toBe(OWNER_ID);
    expect(now).toBeInstanceOf(Date);
    expect(opts).toEqual({ dryRun: true });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['action_ids', 'daily', 'date', 'dry_run', 'lines', 'monday', 'week']);
  });

  it('answers skipped home_off as given', async () => {
    vi.mocked(runLearn).mockResolvedValue({ dry_run: true, skipped: 'home_off', action_ids: [] });
    expect(await (await GET()).json()).toEqual({ dry_run: true, skipped: 'home_off', action_ids: [] });
  });

  it('only ever makes dry-run calls (a GET writes nothing)', async () => {
    await GET();
    expect(vi.mocked(runLearn).mock.calls.every((c) => (c[3] as { dryRun: boolean }).dryRun === true)).toBe(true);
  });
});

describe('learn route: POST', () => {
  it('runs once, for real, for the owner', async () => {
    vi.mocked(runLearn).mockResolvedValue({ dry_run: false, date: '2026-11-23', monday: true, daily, week: null, lines: [], action_ids: ['a1'] });
    const res = await POST(req('POST', PATH, {}) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(runLearn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runLearn).mock.calls[0][1]).toBe(OWNER_ID);
    expect(vi.mocked(runLearn).mock.calls[0][3]).toEqual({ dryRun: false });
    expect((await res.json()).action_ids).toEqual(['a1']);
  });

  it('accepts no body at all', async () => {
    vi.mocked(runLearn).mockResolvedValue({ dry_run: false, already_ran: true, action_ids: [] });
    expect((await POST(req('POST', PATH) as never)).status).toBe(200);
  });

  it('a second POST the same day answers already_ran', async () => {
    vi.mocked(runLearn).mockResolvedValue({ dry_run: false, already_ran: true, action_ids: [] });
    expect(await (await POST(req('POST', PATH, {}) as never)).json()).toEqual({ dry_run: false, already_ran: true, action_ids: [] });
  });

  it('answers skipped home_off as given', async () => {
    vi.mocked(runLearn).mockResolvedValue({ dry_run: false, skipped: 'home_off', action_ids: [] });
    expect(await (await POST(req('POST', PATH, {}) as never)).json()).toEqual({ dry_run: false, skipped: 'home_off', action_ids: [] });
  });

  it('refuses a body with any field with 400 and runs nothing', async () => {
    for (const body of [{ user_id: OWNER_ID }, { dry_run: false }, { x: 1 }]) {
      expect((await POST(req('POST', PATH, body) as never)).status).toBe(400);
    }
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(runLearn).not.toHaveBeenCalled();
  });

  it('refuses a body over the cap with 413', async () => {
    expect((await POST(req('POST', PATH, { pad: 'x'.repeat(5000) }) as never)).status).toBe(413);
    expect(runLearn).not.toHaveBeenCalled();
  });

  it('a failure inside the run is a plain 500 with no detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(runLearn).mockRejectedValue(new Error('secret detail'));
    const res = await POST(req('POST', PATH, {}) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong. Try again.' });
  });
});

describe('learn route: lane and registry', () => {
  it('both methods are in the bast-chat lane allowlist', () => {
    const keys = LANE_ROUTES['bast-chat'].map((r) => `${r.method} ${r.pattern}`);
    expect(keys).toContain(`GET ${PATH}`);
    expect(keys).toContain(`POST ${PATH}`);
  });

  it('both methods are in the registry', () => {
    const e = bastChatEndpoints.find((x) => x.path === PATH);
    expect(e?.group).toBe('bast-chat');
    expect(e?.methods.map((m) => m.method)).toEqual(['GET', 'POST']);
  });
});
