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
vi.mock('@/lib/home/owed/book-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/owed/book-store')>()),
  listBookings: vi.fn(),
  saveBookings: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { listBookings, saveBookings } from '@/lib/home/owed/book-store';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/owed/bookings';
const KEY = 'thread:mike@becomeindelible.com:abc123';
const good = { created: [{ thread_key: KEY, event_id: 'ev1', start: '2026-11-12T19:00:00.000Z', end: '2026-11-12T19:30:00.000Z' }], conflicts: [], deleted: [], failed: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(listBookings).mockResolvedValue({ create: [], delete: [] });
  vi.mocked(saveBookings).mockResolvedValue({ saved: [], refused: [] });
});

describe('owed bookings route', () => {
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
    expect(listBookings).not.toHaveBeenCalled();
    expect(saveBookings).not.toHaveBeenCalled();
  });

  it('GET returns the dry run for the configured owner, no-store', async () => {
    vi.mocked(listBookings).mockResolvedValue({ skipped: 'book_off', create: [], delete: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ skipped: 'book_off', create: [], delete: [] });
    expect(vi.mocked(listBookings).mock.calls[0][1]).toBe(OWNER_ID);
  });

  it('POST saves for the configured owner and fills the empty lists', async () => {
    const res = await POST(req('POST', PATH, { created: good.created }) as never);
    expect(res.status).toBe(200);
    const [, owner, body] = vi.mocked(saveBookings).mock.calls[0];
    expect(owner).toBe(OWNER_ID);
    expect(body.created).toHaveLength(1);
    expect(body.conflicts).toEqual([]);
    expect(body.deleted).toEqual([]);
    expect(body.failed).toEqual([]);
  });

  it('POST is strict: an extra field, a user id, a bad time or too many items is 400 and nothing runs', async () => {
    for (const bad of [
      { ...good, user_id: 'x' },
      { ...good, created: [{ ...good.created[0], attendees: ['a@b.com'] }] },
      { ...good, created: [{ ...good.created[0], start: 'tomorrow' }] },
      { ...good, conflicts: Array.from({ length: 11 }, () => ({ thread_key: KEY })) },
      { ...good, failed: [{ thread_key: 'not a key', error: 'x' }] },
    ]) {
      expect((await POST(req('POST', PATH, bad) as never)).status).toBe(400);
    }
    expect(saveBookings).not.toHaveBeenCalled();
  });
});
