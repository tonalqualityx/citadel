// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique: vi.fn() },
    emailAsk: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/home/emergency/store', async (orig) => {
  const actual = await orig<typeof import('@/lib/home/emergency/store')>();
  return { ...actual, saveNotEmergencyRule: vi.fn(actual.saveNotEmergencyRule) };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { saveNotEmergencyRule } from '@/lib/home/emergency/store';
import { POST } from '../route';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const mockAsk = prisma.emailAsk.findUnique as Mock;
const mockSave = vi.mocked(saveNotEmergencyRule);

const MIKE = '11111111-1111-4111-8111-111111111111';
const ASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function req(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost:3000/api/home/rule', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView });
}
const ok = { item_key: `crisis:${ASK}`, scope: 'sender' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/home/rule: who may call', () => {
  it('401 when signed out', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await POST(req(ok))).status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('403 for an API key (the chat key and any other)', async () => {
    signIn({ via: 'api_key', lane: 'bast-chat', laneEnforced: true });
    const res = await POST(req(ok));
    expect(res.status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
    signIn({ via: 'api_key' });
    expect((await POST(req(ok))).status).toBe(403);
  });
  it('403 for a non-admin, an admin on the Overlook, and an admin with no preference row', async () => {
    signIn({ role: 'pm' });
    expect((await POST(req(ok))).status).toBe(403);
    signIn({}, 'overlook');
    expect((await POST(req(ok))).status).toBe(403);
    signIn({}, null);
    expect((await POST(req(ok))).status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('POST /api/home/rule: body', () => {
  beforeEach(() => signIn());
  it('400 for non-JSON, an empty body, an unknown field, a bad scope and a long reason', async () => {
    expect((await POST(req('{nope', true))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ ...ok, user_id: MIKE }))).status).toBe(400);
    expect((await POST(req({ ...ok, scope: 'everything' }))).status).toBe(400);
    expect((await POST(req({ ...ok, reason: 'x'.repeat(301) }))).status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('a task item is 400 with the security sentence and nothing is looked up', async () => {
    const res = await POST(req({ item_key: `task:${TASK}`, scope: 'sender' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('A security flag is never turned into a rule.');
    expect(mockAsk).not.toHaveBeenCalled();
  });
  it('a sign-off, session, wait or thread item is 400', async () => {
    for (const k of [`wait:${TASK}`, 'session:abc', 'review:none', 'thread:mike@x.test:t1']) {
      expect((await POST(req({ item_key: k, scope: 'sender' }))).status).toBe(400);
    }
  });
  it('a domain rule on free mail is 400', async () => {
    mockAsk.mockResolvedValue({ id: ASK, from_email: 'someone@gmail.com', client_id: null });
    const res = await POST(req({ item_key: `crisis:${ASK}`, scope: 'domain' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/free mail/);
  });
  it('a domain rule on our own domain, and a sender rule on our own address, are 400', async () => {
    mockAsk.mockResolvedValue({ id: ASK, from_email: 'noreply@becomeindelible.com', client_id: null });
    expect((await POST(req({ item_key: `crisis:${ASK}`, scope: 'domain' }))).status).toBe(400);
    mockAsk.mockResolvedValue({ id: ASK, from_email: 'mike@becomeindelible.com', client_id: null });
    expect((await POST(req({ item_key: `crisis:${ASK}`, scope: 'sender' }))).status).toBe(400);
  });
  it('a site scope on a crisis item is 400, and a missing item is 404', async () => {
    mockAsk.mockResolvedValue({ id: ASK, from_email: 'a@wpmudev.com', client_id: null });
    expect((await POST(req({ item_key: `crisis:${ASK}`, scope: 'site' }))).status).toBe(400);
    mockAsk.mockResolvedValue(null);
    expect((await POST(req(ok))).status).toBe(404);
  });
});

describe('POST /api/home/rule: result', () => {
  it('saves for the signed-in user only and answers no-store', async () => {
    signIn();
    mockSave.mockResolvedValueOnce({
      ok: true,
      action_id: 'act',
      undo_until: '2026-11-18T00:00:00.000Z',
      item_key: ok.item_key,
      rule: { key: 'k', kind: 'sender', value: 'a@b.com', revision: 1, line: 'Saved a rule: mail from a@b.com is not an emergency.' },
      message: 'Saved. It will not come back as an emergency.',
    });
    const res = await POST(req({ ...ok, reason: 'Weekly digest' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockSave.mock.calls[0][1]).toBe(MIKE);
    expect(mockSave.mock.calls[0][2]).toEqual({ ...ok, reason: 'Weekly digest' });
    expect((await res.json()).rule.kind).toBe('sender');
  });
});
