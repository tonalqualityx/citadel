// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError, ApiError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn().mockResolvedValue('America/New_York') }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })),
  },
}));
vi.mock('@/lib/home/owed/send', async (orig) => {
  const actual = await orig<typeof import('@/lib/home/owed/send')>();
  return { ...actual, queueOwedReplySend: vi.fn() };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { queueOwedReplySend } from '@/lib/home/owed/send';
import { POST } from '../route';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const mockQueue = vi.mocked(queueOwedReplySend);
const MIKE = '11111111-1111-4111-8111-111111111111';
const ok = { item_key: 'thread:mike@x.test:t1', draft_id: 'd1' };
const req = (body: unknown, raw = false) =>
  new NextRequest('http://localhost:3000/api/home/send', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/home/send: who may call', () => {
  it('401 without a login', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await POST(req(ok))).status).toBe(401);
    expect(mockQueue).not.toHaveBeenCalled();
  });
  it('403 for an API key, whatever its role (the chat key, the courier key, the keeper)', async () => {
    for (const role of ['admin', 'pm', 'tech']) {
      signIn({ via: 'api_key', role });
      expect((await POST(req(ok))).status).toBe(403);
    }
    expect(mockQueue).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('403 for a session that is not an admin, or whose home screen is off or unset', async () => {
    signIn({ role: 'pm' });
    expect((await POST(req(ok))).status).toBe(403);
    signIn({}, 'classic');
    expect((await POST(req(ok))).status).toBe(403);
    signIn({}, null);
    expect((await POST(req(ok))).status).toBe(403);
    expect(mockQueue).not.toHaveBeenCalled();
  });
});

describe('POST /api/home/send: body and result', () => {
  it('400 for bad JSON, a missing draft_id, or an extra field (no user id anywhere)', async () => {
    signIn();
    expect((await POST(req('{', true))).status).toBe(400);
    expect((await POST(req({ item_key: ok.item_key }))).status).toBe(400);
    expect((await POST(req({ ...ok, user_id: MIKE }))).status).toBe(400);
    expect(mockQueue).not.toHaveBeenCalled();
  });
  it('200 passes the signed-in user, never one from the body, and returns the queue result', async () => {
    signIn();
    mockQueue.mockResolvedValue({ ok: true, action_id: 'a1', send_after: '2026-11-12T15:10:00.000Z', item_key: ok.item_key, message: 'Sending your reply to Dana at 10:10 AM.' });
    const res = await POST(req(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, action_id: 'a1', send_after: '2026-11-12T15:10:00.000Z' });
    expect(mockQueue.mock.calls[0][1]).toBe(MIKE);
    expect(mockQueue.mock.calls[0][2]).toEqual(ok);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('the switch off is a 409 send_off with its plain sentence', async () => {
    signIn();
    mockQueue.mockRejectedValue(new ApiError('Sending from here is not turned on.', 409, 'send_off'));
    const res = await POST(req(ok));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Sending from here is not turned on.', code: 'send_off' });
  });
});
