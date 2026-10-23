import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Fleet item 6: lane-scoped API keys, checked in authenticateApiKey against x-citadel-route.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/auth/jwt', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
    apiKeyViolation: { create: vi.fn() },
    emailOutbox: { findMany: vi.fn() },
  },
}));

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '../middleware';
import { resetKeyViolationThrottle } from '../key-violations';
import { requireEngine } from '@/lib/engine/auth';
import { GET as outboxGET } from '@/app/api/email-outbox/route';

const mockCookies = cookies as Mock;
const mockHeaders = headers as Mock;
const findKey = prisma.apiKey.findFirst as Mock;
const updateKey = prisma.apiKey.update as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const outboxRows = prisma.emailOutbox.findMany as Mock;

const USER = { id: 'user-mike', email: 'mike@example.test', role: 'admin', is_active: true };

function keyRow(scopes: string[], over: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    key_prefix: 'citadel_0123abcd',
    scopes,
    expires_at: null,
    is_revoked: false,
    user: USER,
    ...over,
  };
}

/** Bearer request headers as the route sees them after the proxy (route = null means no proxy). */
function request(route: string | null, bearer = 'citadel_fake_test_key') {
  const map: Record<string, string> = { authorization: `Bearer ${bearer}` };
  if (route !== null) map['x-citadel-route'] = route;
  mockHeaders.mockResolvedValue({ get: (n: string) => map[n.toLowerCase()] ?? null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyViolationThrottle();
  mockCookies.mockResolvedValue({ get: () => undefined });
  updateKey.mockResolvedValue({});
  createViolation.mockResolvedValue({});
  outboxRows.mockResolvedValue([]);
});

describe('lane key on a real route (GET /api/email-outbox)', () => {
  it('allowed route: 200, no violation row', async () => {
    findKey.mockResolvedValue(keyRow(['lane:courier']));
    request('GET /api/email-outbox');
    const res = await outboxGET();
    expect(res.status).toBe(200);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('allowed route in enforce mode: still 200', async () => {
    findKey.mockResolvedValue(keyRow(['lane:courier', 'scope-mode:enforce']));
    request('GET /api/email-outbox');
    expect((await outboxGET()).status).toBe(200);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('disallowed route in shadow: 200 plus one violation row', async () => {
    findKey.mockResolvedValue(keyRow(['lane:qbo']));
    request('GET /api/email-outbox');
    const res = await outboxGET();
    expect(res.status).toBe(200);
    expect(createViolation).toHaveBeenCalledTimes(1);
    expect(createViolation).toHaveBeenCalledWith({
      data: {
        api_key_id: 'key-1',
        key_prefix: 'citadel_0123abcd',
        lane: 'qbo',
        method: 'GET',
        path: '/api/email-outbox',
        enforced: false,
      },
    });
  });

  it('disallowed route in enforce: 403, violation row marked enforced, handler never runs', async () => {
    findKey.mockResolvedValue(keyRow(['lane:qbo', 'scope-mode:enforce']));
    request('GET /api/email-outbox');
    const res = await outboxGET();
    expect(res.status).toBe(403);
    expect(outboxRows).not.toHaveBeenCalled();
    expect(createViolation).toHaveBeenCalledWith({ data: expect.objectContaining({ enforced: true, lane: 'qbo' }) });
  });

  it('lane key with no route header: 403 in shadow and in enforce', async () => {
    for (const scopes of [['lane:courier'], ['lane:courier', 'scope-mode:enforce']]) {
      resetKeyViolationThrottle();
      findKey.mockResolvedValue(keyRow(scopes));
      request(null);
      const res = await outboxGET();
      expect(res.status).toBe(403);
    }
    expect(outboxRows).not.toHaveBeenCalled();
  });

  it('lane key with a malformed route header: 403', async () => {
    findKey.mockResolvedValue(keyRow(['lane:courier']));
    request('garbage');
    expect((await outboxGET()).status).toBe(403);
  });

  it('an unknown lane name allows nothing (enforce: 403)', async () => {
    findKey.mockResolvedValue(keyRow(['lane:nope', 'scope-mode:enforce']));
    request('GET /api/email-outbox');
    expect((await outboxGET()).status).toBe(403);
  });
});

describe('payload', () => {
  it('a lane key returns apiKeyId and lane', async () => {
    findKey.mockResolvedValue(keyRow(['lane:courier']));
    request('GET /api/email-outbox');
    expect(await requireAuth()).toEqual({
      userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1', lane: 'courier',
    });
  });
});

describe('violation throttle', () => {
  it('writes at most one row per key, method and path per minute', async () => {
    findKey.mockResolvedValue(keyRow(['lane:qbo']));
    request('GET /api/email-outbox');
    for (let i = 0; i < 5; i++) await requireAuth();
    expect(createViolation).toHaveBeenCalledTimes(1);
    request('GET /api/sites/abc');
    await requireAuth();
    expect(createViolation).toHaveBeenCalledTimes(2);
  });

  it('a failed violation write never fails the request', async () => {
    findKey.mockResolvedValue(keyRow(['lane:qbo']));
    createViolation.mockRejectedValue(new Error('db down'));
    request('GET /api/email-outbox');
    expect((await outboxGET()).status).toBe(200);
  });
});

// 20 real routes across the app, sampled from app/api (method + concrete path).
const SAMPLED_ROUTES = [
  'GET /api/tasks',
  'POST /api/tasks',
  'PATCH /api/tasks/0b6e1c2a-1111-4222-8333-444455556666',
  'POST /api/tasks/0b6e1c2a-1111-4222-8333-444455556666/comments',
  'GET /api/sites',
  'PUT /api/sites/0b6e1c2a-1111-4222-8333-444455556666/pages',
  'GET /api/clients/0b6e1c2a-1111-4222-8333-444455556666',
  'GET /api/projects',
  'GET /api/arcs',
  'POST /api/session-tasks',
  'GET /api/email-outbox',
  'POST /api/waits/sweep',
  'GET /api/approval-requests',
  'GET /api/oracle/projects',
  'POST /api/oracle/ingest',
  'GET /api/troubador/work-queue',
  'GET /api/admin/integrations',
  'POST /api/api-keys',
  'GET /api/auth/me',
  'DELETE /api/api-keys/0b6e1c2a-1111-4222-8333-444455556666',
];

describe('keys without a lane scope are unchanged', () => {
  it.each(SAMPLED_ROUTES)('unscoped key on %s: same payload, no violation', async (route) => {
    findKey.mockResolvedValue(keyRow([]));
    request(route);
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1' });
    request(null);
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1' });
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('has 20 distinct sampled routes', () => {
    expect(new Set(SAMPLED_ROUTES).size).toBe(20);
  });

  it('an engine key passes requireAuth exactly as before (no lane check)', async () => {
    findKey.mockResolvedValue(keyRow(['engine']));
    request('GET /api/email-outbox');
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1' });
    request(null);
    expect((await outboxGET()).status).toBe(200);
    expect(createViolation).not.toHaveBeenCalled();
  });
});

describe('requireEngine is unchanged', () => {
  it('accepts an engine key with or without a route header', async () => {
    findKey.mockResolvedValue(keyRow(['engine']));
    request(null);
    await expect(requireEngine()).resolves.toEqual({ userId: 'user-mike', apiKeyId: 'key-1' });
    request('POST /api/engine/claim');
    await expect(requireEngine()).resolves.toEqual({ userId: 'user-mike', apiKeyId: 'key-1' });
  });

  it('still refuses a lane key (no engine scope) with 403', async () => {
    findKey.mockResolvedValue(keyRow(['lane:bast']));
    request('POST /api/engine/claim');
    await expect(requireEngine()).rejects.toMatchObject({ statusCode: 403 });
  });
});
