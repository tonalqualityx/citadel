// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { userPreference: { findUnique: vi.fn() } } }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/learn/weights-store', () => ({
  learningOn: vi.fn(async () => true),
  putBack: vi.fn(async () => ({ action_id: 'act-1', undo_until: '2026-12-01T00:00:00.000Z' })),
  setLearning: vi.fn(async () => true),
}));
vi.mock('@/lib/home/learn/learned', () => ({
  listLearned: vi.fn(async () => [{ evidence_key: 'client:x', sentence: 'Nerd Herd work comes up a little sooner, since November 30', since: '2026-11-30T15:00:00.000Z' }]),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { learningOn, putBack, setLearning } from '@/lib/home/learn/weights-store';
import { GET, POST } from '../route';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const MIKE = '11111111-1111-4111-8111-111111111111';

function req(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost:3000/api/home/learned', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView });
}

beforeEach(() => vi.clearAllMocks());

describe('/api/home/learned: who may call', () => {
  it('401 when signed out', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await GET()).status).toBe(401);
    expect((await POST(req({ action: 'learning', on: false }))).status).toBe(401);
  });
  it('403 for an API key (the chat key and any other) on both verbs, and nothing is written', async () => {
    signIn({ via: 'api_key', lane: 'bast-chat', laneEnforced: true });
    expect((await GET()).status).toBe(403);
    expect((await POST(req({ action: 'learning', on: false }))).status).toBe(403);
    expect((await POST(req({ action: 'put_back', evidence_key: 'client:x' }))).status).toBe(403);
    expect(setLearning).not.toHaveBeenCalled();
    expect(putBack).not.toHaveBeenCalled();
  });
  it('403 for a non-admin and for an admin who is not on the home view', async () => {
    signIn({ role: 'tech' });
    expect((await GET()).status).toBe(403);
    signIn({}, 'overlook');
    expect((await POST(req({ action: 'learning', on: false }))).status).toBe(403);
    signIn({}, null);
    expect((await GET()).status).toBe(403);
    expect(setLearning).not.toHaveBeenCalled();
  });
});

describe('GET /api/home/learned', () => {
  it('returns on and sentences only: no weight, percent or count', async () => {
    signIn();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ on: true, items: [{ evidence_key: 'client:x', sentence: 'Nerd Herd work comes up a little sooner, since November 30', since: '2026-11-30T15:00:00.000Z' }] });
    expect(JSON.stringify(body)).not.toMatch(/weight|pct|percent|signals/i);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('POST /api/home/learned', () => {
  beforeEach(() => signIn());
  it('400 for non-JSON, an empty body, an unknown action, an unknown field and a wrong type', async () => {
    expect((await POST(req('{nope', true))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ action: 'set_weight', evidence_key: 'client:x', weight_pct: 120 }))).status).toBe(400);
    expect((await POST(req({ action: 'learning', on: false, user_id: MIKE }))).status).toBe(400);
    expect((await POST(req({ action: 'learning', on: 'no' }))).status).toBe(400);
    expect((await POST(req({ action: 'put_back' }))).status).toBe(400);
    expect((await POST(req({ action: 'put_back', evidence_key: 'client:x', weight_pct: 100 }))).status).toBe(400);
    expect(setLearning).not.toHaveBeenCalled();
    expect(putBack).not.toHaveBeenCalled();
  });
  it('put_back puts the key back and returns the list with the action id', async () => {
    const res = await POST(req({ action: 'put_back', evidence_key: 'client:x' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(putBack).toHaveBeenCalledWith(expect.anything(), MIKE, 'client:x', expect.any(Date));
    expect(body).toMatchObject({ ok: true, on: true, action_id: 'act-1' });
    expect(body.items).toHaveLength(1);
  });
  it('learning switches the owner\'s switch and says so', async () => {
    vi.mocked(learningOn).mockResolvedValueOnce(false);
    const res = await POST(req({ action: 'learning', on: false }));
    expect(setLearning).toHaveBeenCalledWith(expect.anything(), MIKE, false);
    expect(await res.json()).toMatchObject({ ok: true, on: false });
  });
});
