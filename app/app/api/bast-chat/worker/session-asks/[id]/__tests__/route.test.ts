// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, ctx, req } from '../../../../__tests__/harness';

const h = vi.hoisted(() => ({ ownerId: '3ecfb7be-0000-4000-8000-000000000001' as string | null, asks: [] as unknown[] }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
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
vi.mock('@/lib/home/load', () => ({ loadSessionAsksFor: vi.fn(async () => h.asks) }));

import { requireAuth } from '@/lib/auth/middleware';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { bastChatEndpoints } from '@/lib/api/registry/bast-chat';
import { loadSessionAsksFor } from '@/lib/home/load';
import { GET } from '../route';

const P = '/api/bast-chat/worker/session-asks';
const ROW = '5c0f2a3b-0000-4000-8000-0000000000aa';
const ask = (over: Record<string, unknown> = {}) => ({
  id: ROW,
  external_id: 'sess-abc.1',
  title: 'Griswold chatbot',
  waiting_on: 'Pick the tone for the welcome message.',
  asked_at: new Date('2026-11-10T14:00:00Z'),
  remote_url: 'https://claude.ai/code/session_x',
  client: { id: 'c1', name: 'Griswold' },
  project: { id: 'p1', name: 'Chatbot' },
  ...over,
});
const get = (id: string) => GET(req('GET', `${P}/${id}`) as never, ctx({ id }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  h.asks = [ask()];
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
});

describe('GET worker/session-asks/:id', () => {
  it('is in the lane list and the registry', () => {
    expect(LANE_ROUTES['bast-chat'].map((r) => `${r.method} ${r.pattern}`)).toContain('GET /api/bast-chat/worker/session-asks/:id');
    expect(bastChatEndpoints.some((e) => e.path === '/api/bast-chat/worker/session-asks/:id')).toBe(true);
  });
  it('401 signed out, 403 for everyone but the chat worker', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await get('sess-abc.1')).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await get('sess-abc.1')).status).toBe(403);
    }
    expect(loadSessionAsksFor).not.toHaveBeenCalled();
  });
  it('returns the exact shape by external id, no-store, for the owner only', async () => {
    const res = await get('sess-abc.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      title: 'Griswold chatbot',
      waiting_on: 'Pick the tone for the welcome message.',
      since: '2026-11-10T14:00:00.000Z',
      session_url: 'https://claude.ai/code/session_x',
      client: 'Griswold',
      project: 'Chatbot',
      home_key: 'session:sess-abc.1',
    });
    expect(loadSessionAsksFor).toHaveBeenCalledWith(expect.anything(), OWNER_ID);
  });
  it('finds it by the row id too, and nulls what is missing', async () => {
    h.asks = [ask({ remote_url: null, client: null, project: null, title: null })];
    const b = await (await get(ROW)).json();
    expect(b).toMatchObject({ title: null, session_url: null, client: null, project: null, home_key: 'session:sess-abc.1' });
  });
  it('caps the ask at 2000 characters', async () => {
    h.asks = [ask({ waiting_on: 'x'.repeat(5000) })];
    expect((await (await get('sess-abc.1')).json()).waiting_on).toHaveLength(2000);
  });
  it('404 for a session that is not waiting (or was cleared), an id that is not a token, and no chat owner', async () => {
    expect((await get('other')).status).toBe(404);
    h.asks = [];
    expect((await get('sess-abc.1')).status).toBe(404);
    expect((await get('has space')).status).toBe(404);
    expect((await get('a'.repeat(121))).status).toBe(404);
    h.asks = [ask()];
    h.ownerId = null;
    expect((await get('sess-abc.1')).status).toBe(404);
  });
});
