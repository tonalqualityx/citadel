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
  return new NextRequest('http://localhost:3000/api/home/undo', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView, timezone: 'America/New_York' });
}

const validBody = { action_id: ACTION };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/home/undo access', () => {
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

describe('POST /api/home/undo validation', () => {
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

describe('POST /api/home/undo results', () => {
  it('undoes for the signed-in user only', async () => {
    signIn();
    mockUndo.mockResolvedValue({ ok: true, action_id: ACTION, item_key: T1 });
    const res = await POST(req({ action_id: ACTION }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action_id: ACTION, item_key: T1 });
    expect(mockUndo.mock.calls[0][1]).toBe(MIKE);
    expect(mockUndo.mock.calls[0][2]).toBe(ACTION);
  });

  it.each([
    ['undo_expired', 409],
    ['undo_used', 409],
    ['not_undoable', 409],
    ['not_found', 404],
  ] as const)('%s answers %i with its code', async (code, status) => {
    signIn();
    mockUndo.mockRejectedValue(new HomeActError(code));
    const res = await POST(req({ action_id: ACTION }));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
});
