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
vi.mock('@/lib/home/keeper/summaries', () => ({ listSummaryWork: vi.fn(), saveSummaries: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { listSummaryWork, saveSummaries } from '@/lib/home/keeper/summaries';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { bastChatEndpoints } from '@/lib/api/registry/bast-chat';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/home-keeper/summaries';
const HASH = 'a'.repeat(64);
const item = (n = 1) => ({ item_key: `task:${n}`, hash: HASH, summary: 'Short.' });
const saved = { dry_run: false as const, saved: 1, refused: [], skipped: [], action_id: 'a1', line: 'Wrote a short version of 1 long card. The full notes stay one click away.' };

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(listSummaryWork).mockResolvedValue({ items: [] });
  vi.mocked(saveSummaries).mockResolvedValue(saved);
});

const callers: [string, () => Promise<Response>][] = [
  ['GET', () => GET(req('GET', PATH) as never)],
  ['POST', () => POST(req('POST', PATH, { items: [item()] }) as never)],
];

describe('summaries route: who may call', () => {
  for (const [name, call] of callers) {
    it(`${name}: 401 when signed out`, async () => {
      vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
      expect((await call()).status).toBe(401);
      expect(listSummaryWork).not.toHaveBeenCalled();
      expect(saveSummaries).not.toHaveBeenCalled();
    });
    for (const [who, auth] of NOT_WORKERS) {
      it(`${name}: 403 for ${who}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(auth);
        expect((await call()).status).toBe(403);
        expect(listSummaryWork).not.toHaveBeenCalled();
        expect(saveSummaries).not.toHaveBeenCalled();
      });
    }
    it(`${name}: 404 when no chat owner is configured`, async () => {
      h.ownerId = null;
      expect((await call()).status).toBe(404);
      expect(listSummaryWork).not.toHaveBeenCalled();
      expect(saveSummaries).not.toHaveBeenCalled();
    });
  }
});

describe('summaries route: GET', () => {
  it('lists for the configured owner, no-store, default 40', async () => {
    vi.mocked(listSummaryWork).mockResolvedValue({ items: [{ item_key: 'task:1', task_id: '1', title: 'T', text: 'x', hash: HASH, has_checklist: false }] });
    const res = await GET(req('GET', PATH) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).items).toHaveLength(1);
    const c = vi.mocked(listSummaryWork).mock.calls[0];
    expect(c[1]).toBe(OWNER_ID);
    expect(c[3]).toBe(40);
  });
  it('limit only lowers the cap, and a bad limit means 40', async () => {
    await GET(req('GET', `${PATH}?limit=5`) as never);
    await GET(req('GET', `${PATH}?limit=500`) as never);
    await GET(req('GET', `${PATH}?limit=abc`) as never);
    expect(vi.mocked(listSummaryWork).mock.calls.map((c) => c[3])).toEqual([5, 40, 40]);
  });
  it('answers skipped home_off as given', async () => {
    vi.mocked(listSummaryWork).mockResolvedValue({ skipped: 'home_off', items: [] });
    expect(await (await GET(req('GET', PATH) as never)).json()).toEqual({ skipped: 'home_off', items: [] });
  });
});

describe('summaries route: POST', () => {
  it('saves for the owner and answers as given, no-store', async () => {
    const res = await POST(req('POST', PATH, { items: [item(1), item(2)] }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(saved);
    const c = vi.mocked(saveSummaries).mock.calls[0];
    expect(c[1]).toBe(OWNER_ID);
    expect(c[3]).toHaveLength(2);
  });
  it('refuses more than 40 items, a bad hash, an extra field and a user id with 400', async () => {
    const bad = [
      { items: Array.from({ length: 41 }, (_, i) => item(i)) },
      { items: [{ ...item(), hash: 'nope' }] },
      { items: [{ ...item(), extra: 1 }] },
      { items: [item()], user_id: OWNER_ID },
      { items: 'x' },
      {},
    ];
    for (const b of bad) expect((await POST(req('POST', PATH, b) as never)).status).toBe(400);
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(saveSummaries).not.toHaveBeenCalled();
  });
  it('accepts 40 items and an empty list', async () => {
    expect((await POST(req('POST', PATH, { items: Array.from({ length: 40 }, (_, i) => item(i)) }) as never)).status).toBe(200);
    expect((await POST(req('POST', PATH, { items: [] }) as never)).status).toBe(200);
  });
});

describe('summaries route: lane and registry', () => {
  it('both methods are on the bast-chat lane and documented', () => {
    const lane = LANE_ROUTES['bast-chat'].filter((r) => r.pattern === PATH).map((r) => r.method).sort();
    expect(lane).toEqual(['GET', 'POST']);
    const e = bastChatEndpoints.find((x) => x.path === PATH);
    expect(e?.methods.map((m) => m.method)).toEqual(['GET', 'POST']);
  });
});
