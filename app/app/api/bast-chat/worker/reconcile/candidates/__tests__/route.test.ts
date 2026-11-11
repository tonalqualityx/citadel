// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../../__tests__/harness';

const h = vi.hoisted(() => ({ ownerId: '3ecfb7be-0000-4000-8000-000000000001' as string | null, writes: 0 }));

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
vi.mock('@/lib/home/keeper/run', () => ({ ownerOnHome: vi.fn() }));
vi.mock('@/lib/home/reconcile/load', async (orig) => ({ ...(await orig<typeof import('@/lib/home/reconcile/load')>()), candidatesFor: vi.fn(), reconcileOn: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { ownerOnHome } from '@/lib/home/keeper/run';
import { candidatesFor, reconcileOn } from '@/lib/home/reconcile/load';
import { POST } from '../route';

const PATH = '/api/bast-chat/worker/reconcile/candidates';
const m = (k = 'a@b') => ({ message_key: k, account: 'mike@becomeindelible.com', thread_id: 't1', thread_rfc_ids: [], to: [{ email: 'kue@x.test', name: '' }], cc: [], subject: 's', sent_at: '2026-11-09T15:00:00Z' });

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(ownerOnHome).mockResolvedValue({ ok: true, timezone: 'America/New_York' });
  vi.mocked(reconcileOn).mockResolvedValue(true);
  vi.mocked(candidatesFor).mockImplementation(async (_db, _o, msg) => ({ message_key: msg.message_key, client: null, tasks: [], sessions: [], waits: [], projects: [], retainer: null, tracked_hint: null }));
});

describe('worker reconcile candidates route', () => {
  it('401, 403 for everyone but the chat worker, 404 with no owner; nothing runs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req('POST', PATH, { messages: [m()] }) as never)).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await POST(req('POST', PATH, { messages: [m()] }) as never)).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue(WORKER);
    h.ownerId = null;
    expect((await POST(req('POST', PATH, { messages: [m()] }) as never)).status).toBe(404);
    expect(candidatesFor).not.toHaveBeenCalled();
  });

  it('answers one entry per message, in order, for the configured owner; the loader only reads', async () => {
    const res = await POST(req('POST', PATH, { messages: [m('a@b'), m('c@d')] }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).messages.map((x: { message_key: string }) => x.message_key)).toEqual(['a@b', 'c@d']);
    expect(vi.mocked(candidatesFor).mock.calls.map((c) => c[1])).toEqual([OWNER_ID, OWNER_ID]);
  });

  it('home_off and reconcile_off are skipped, with no loader call', async () => {
    vi.mocked(ownerOnHome).mockResolvedValue({ ok: false, timezone: 'America/New_York' });
    expect(await (await POST(req('POST', PATH, { messages: [m()] }) as never)).json()).toEqual({ skipped: 'home_off', messages: [] });
    vi.mocked(ownerOnHome).mockResolvedValue({ ok: true, timezone: 'America/New_York' });
    vi.mocked(reconcileOn).mockResolvedValue(false);
    expect(await (await POST(req('POST', PATH, { messages: [m()] }) as never)).json()).toEqual({ skipped: 'reconcile_off', messages: [] });
    expect(candidatesFor).not.toHaveBeenCalled();
  });

  it('is strict: 11 messages, an extra field or a user id is 400; over 64 KB is 413', async () => {
    for (const bad of [{ messages: Array.from({ length: 11 }, (_, i) => m(`k${i}`)) }, { messages: [{ ...m(), extra: 1 }] }, { messages: [m()], user_id: 'x' }, { messages: [] }]) {
      expect((await POST(req('POST', PATH, bad) as never)).status).toBe(400);
    }
    expect((await POST(req('POST', PATH, { messages: [m()], pad: 'p'.repeat(70_000) }) as never)).status).toBe(413);
    expect(candidatesFor).not.toHaveBeenCalled();
  });
});
