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
vi.mock('@/lib/home/emergency/slack-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/emergency/slack-store')>()),
  ackLines: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { ackLines } from '@/lib/home/emergency/slack-store';
import { POST } from '../route';

const PATH = '/api/bast-chat/worker/home-watch/ack';
const ID = '11111111-1111-4111-8111-111111111111:first';

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(ackLines).mockResolvedValue({ acked: 1, ignored: 0 });
});

describe('home-watch ack route', () => {
  it('401 signed out, 403 for everyone but the chat worker, 404 with no owner; nothing runs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req('POST', PATH, { ids: [ID] }) as never)).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await POST(req('POST', PATH, { ids: [ID] }) as never)).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue(WORKER);
    h.ownerId = null;
    expect((await POST(req('POST', PATH, { ids: [ID] }) as never)).status).toBe(404);
    expect(ackLines).not.toHaveBeenCalled();
  });

  it('acknowledges the ids for the configured owner, no-store', async () => {
    const res = await POST(req('POST', PATH, { ids: [ID] }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ acked: 1, ignored: 0 });
    const [, owner, ids] = vi.mocked(ackLines).mock.calls[0];
    expect(owner).toBe(OWNER_ID);
    expect(ids).toEqual([ID]);
  });

  it('400 for an extra field, a user id, no ids, too many ids, a non-string id and non-JSON', async () => {
    const many = Array.from({ length: 21 }, () => ID);
    for (const body of [{ ids: [ID], user_id: OWNER_ID }, { ids: [] }, {}, { ids: many }, { ids: [5] }, { ids: 'x' }]) {
      expect((await POST(req('POST', PATH, body) as never)).status).toBe(400);
    }
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(ackLines).not.toHaveBeenCalled();
  });

  it('accepts exactly 20 ids', async () => {
    expect((await POST(req('POST', PATH, { ids: Array.from({ length: 20 }, () => ID) }) as never)).status).toBe(200);
  });
});
