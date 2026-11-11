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
vi.mock('@/lib/home/reconcile/load', async (orig) => ({ ...(await orig<typeof import('@/lib/home/reconcile/load')>()), loadContext: vi.fn() }));
vi.mock('@/lib/home/reconcile/store', async (orig) => ({ ...(await orig<typeof import('@/lib/home/reconcile/store')>()), saveReconcile: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { loadContext } from '@/lib/home/reconcile/load';
import { saveReconcile } from '@/lib/home/reconcile/store';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/reconcile';
const msg = (k = 'a@b') => ({
  message_key: k,
  account: 'mike@becomeindelible.com',
  gmail_id: 'g1',
  thread_id: 't1',
  thread_root: 't1',
  sent_at: '2026-11-09T15:00:00Z',
  to_label: 'kue@x.test',
  subject: 'Re: x',
  lookback: false,
  bast_words: false,
  new_part: 'I removed it.',
  quoted_part_hash: '0'.repeat(64),
  filter: { model: 'haiku', cost_usd: 0.01 },
  match: null,
  outcome: 'nothing',
  actions: [],
});
const good = { dry: true, messages: [msg()] };

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(loadContext).mockResolvedValue({ owner_ok: true, on: true, auto: false, caps: { notes_left: 20, cards_left: 10 }, processed: [], holds: [], bast_draft_hashes: [], lookback_done: false });
  vi.mocked(saveReconcile).mockResolvedValue({ messages: [] });
});

describe('worker reconcile route', () => {
  it('401 signed out, 403 for everyone but the chat worker, 404 with no owner; nothing runs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await GET()).status).toBe(401);
    expect((await POST(req('POST', PATH, good) as never)).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await GET()).status).toBe(403);
      expect((await POST(req('POST', PATH, good) as never)).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue(WORKER);
    h.ownerId = null;
    expect((await GET()).status).toBe(404);
    expect((await POST(req('POST', PATH, good) as never)).status).toBe(404);
    expect(loadContext).not.toHaveBeenCalled();
    expect(saveReconcile).not.toHaveBeenCalled();
  });

  it('GET answers the context for the configured owner, no-store, with no user id taken from the request', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ owner_ok: true, auto: false, caps: { notes_left: 20, cards_left: 10 } });
    expect(vi.mocked(loadContext).mock.calls[0][1]).toBe(OWNER_ID);
  });

  it('GET passes home_off through', async () => {
    vi.mocked(loadContext).mockResolvedValue({ skipped: 'home_off', owner_ok: false, on: false });
    expect(await (await GET()).json()).toEqual({ skipped: 'home_off', owner_ok: false, on: false });
  });

  it('POST gives a dry and a real body to the same function for the configured owner', async () => {
    for (const dry of [true, false]) {
      const res = await POST(req('POST', PATH, { dry, messages: [msg()] }) as never);
      expect(res.status).toBe(200);
    }
    const calls = vi.mocked(saveReconcile).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toBe(OWNER_ID);
    expect(calls[0][2].dry).toBe(true);
    expect(calls[1][2].dry).toBe(false);
  });

  it('POST accepts the look-back end marker exactly as the machine sends it', async () => {
    const res = await POST(req('POST', PATH, { dry: false, lookback_end: true, messages: [] }) as never);
    expect(res.status).toBe(200);
    expect(vi.mocked(saveReconcile).mock.calls[0][2]).toMatchObject({ lookback_end: true, messages: [] });
  });

  it('POST is strict: an extra field, a user id, no dry flag, 11 messages or an end marker with messages is 400 and nothing runs', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => msg(`k${i}`));
    for (const bad of [
      { ...good, user_id: 'x' },
      { messages: [msg()] },
      { dry: true, messages: [{ ...msg(), extra: 1 }] },
      { dry: true, messages: eleven },
      { dry: false, lookback_end: true, messages: [msg()] },
      { dry: true, messages: [] },
    ]) {
      expect((await POST(req('POST', PATH, bad) as never)).status).toBe(400);
    }
    expect(saveReconcile).not.toHaveBeenCalled();
  });

  it('POST over 128 KB is 413', async () => {
    const big = { dry: true, messages: [{ ...msg(), new_part: 'x'.repeat(6000) }, ...Array.from({ length: 9 }, (_, i) => ({ ...msg(`k${i}`), subject: 'y'.repeat(500), to_label: 'z'.repeat(300) }))], pad: 'p'.repeat(140_000) };
    expect((await POST(req('POST', PATH, big) as never)).status).toBe(413);
    expect(saveReconcile).not.toHaveBeenCalled();
  });
});
