import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/home/act', async () => {
  const actual = await vi.importActual<typeof import('@/lib/home/act')>('@/lib/home/act');
  return { ...actual, runHomeAct: vi.fn(), runHomeUndo: vi.fn() };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { HomeActError, runHomeAct, runHomeUndo } from '@/lib/home/act';
import { POST } from '../route';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const mockAct = vi.mocked(runHomeAct);
const mockUndo = vi.mocked(runHomeUndo);

const MIKE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T1 = 'task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION = '33333333-3333-4333-8333-333333333333';

function req(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost:3000/api/home/act', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView, timezone: 'America/New_York' });
}

const validBody = { action: 'not_now', item_key: T1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/home/act access', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(mockAct).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('403 for a user who is not an admin', async () => {
    signIn({ role: 'pm' });
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect(mockAct).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('403 for an admin whose home_view is overlook', async () => {
    signIn({}, 'overlook');
    expect((await POST(req(validBody))).status).toBe(403);
    expect(mockAct).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('403 for an admin with no preference row', async () => {
    signIn({}, null);
    expect((await POST(req(validBody))).status).toBe(403);
  });

  it('403 for an API key', async () => {
    signIn({ via: 'api_key' });
    expect((await POST(req(validBody))).status).toBe(403);
    expect(mockAct).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });
});

describe('POST /api/home/act validation', () => {
  it('400 for a body that is not JSON', async () => {
    signIn();
    expect((await POST(req('{nope', true))).status).toBe(400);
  });

  it('400 for a body that names a user', async () => {
    signIn();
    const res = await POST(req({ ...validBody, user_id: OTHER }));
    expect(res.status).toBe(400);
    expect(mockAct).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('400 for an empty body', async () => {
    signIn();
    expect((await POST(req({}))).status).toBe(400);
  });
});

describe('POST /api/home/act results', () => {
  it('runs the action for the signed-in user only', async () => {
    signIn();
    mockAct.mockResolvedValue({ ok: true, action_id: ACTION, undo_until: null, item_key: T1, message: 'Moved up.' });
    const res = await POST(req({ action: 'matters_more', item_key: T1 }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).action_id).toBe(ACTION);
    const call = mockAct.mock.calls[0];
    expect(call[1]).toBe(MIKE);
    expect(call[2]).toEqual({ action: 'matters_more', item_key: T1 });
    expect(call[3].timezone).toBe('America/New_York');
    expect(call[3].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('409 pin_conflict with the exact sentence', async () => {
    signIn();
    mockAct.mockRejectedValue(new HomeActError('pin_conflict'));
    const res = await POST(req({ action: 'pin', item_key: T1 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Switch to this one? The other goes back to its place.',
      code: 'pin_conflict',
    });
  });

  it('passes switch: true through', async () => {
    signIn();
    mockAct.mockResolvedValue({ ok: true, action_id: ACTION, undo_until: null, item_key: T1, message: null });
    await POST(req({ action: 'pin', item_key: T1, switch: true }));
    expect(mockAct.mock.calls[0][2]).toEqual({ action: 'pin', item_key: T1, switch: true });
  });

  it('409 stale_day and unknown_group carry their codes', async () => {
    signIn();
    mockAct.mockRejectedValueOnce(new HomeActError('stale_day'));
    const stale = await POST(req({ action: 'not_now', item_key: T1 }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('stale_day');
    mockAct.mockRejectedValueOnce(new HomeActError('unknown_group'));
    const unknown = await POST(req({ action: 'not_now', item_key: T1 }));
    expect((await unknown.json()).code).toBe('unknown_group');
  });
});
