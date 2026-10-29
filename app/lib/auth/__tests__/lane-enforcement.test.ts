import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Fleet item 6: lane-scoped API keys, checked in authenticateApiKey against x-citadel-route.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/auth/jwt', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
    apiKeyViolation: { create: vi.fn(), deleteMany: vi.fn() },
    emailOutbox: { findMany: vi.fn() },
  },
}));

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '../middleware';
import { recordKeyViolation, resetKeyViolationThrottle, KEY_CAP_PER_MINUTE } from '../key-violations';
import { requireEngine } from '@/lib/engine/auth';
import { GET as outboxGET } from '@/app/api/email-outbox/route';

const mockCookies = cookies as Mock;
const mockHeaders = headers as Mock;
const findKey = prisma.apiKey.findFirst as Mock;
const updateKey = prisma.apiKey.update as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const deleteOld = prisma.apiKeyViolation.deleteMany as Mock;
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
  deleteOld.mockResolvedValue({ count: 0 });
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
      userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1', via: 'api_key', lane: 'courier', laneEnforced: false,
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
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1', via: 'api_key' });
    request(null);
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1', via: 'api_key' });
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('has 20 distinct sampled routes', () => {
    expect(new Set(SAMPLED_ROUTES).size).toBe(20);
  });

  it('an engine key passes requireAuth exactly as before (no lane check)', async () => {
    findKey.mockResolvedValue(keyRow(['engine']));
    request('GET /api/email-outbox');
    expect(await requireAuth()).toEqual({ userId: 'user-mike', email: 'mike@example.test', role: 'admin', apiKeyId: 'key-1', via: 'api_key' });
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

describe('lane keys never reach key minting or the admin surface', () => {
  const forbidden = [
    'GET /api/api-keys', 'POST /api/api-keys', 'PATCH /api/api-keys/abc', 'DELETE /api/api-keys/abc',
    'GET /api/admin/key-violations', 'POST /api/admin/portal-request-notice', 'GET /api/admin/integrations',
  ];
  it.each(forbidden)('shadow lane key on %s: 403 with an enforced violation row', async (route) => {
    findKey.mockResolvedValue(keyRow(['lane:porter']));
    request(route);
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    expect(createViolation).toHaveBeenCalledWith({ data: expect.objectContaining({ enforced: true, lane: 'porter' }) });
  });
  it('enforce lane key is refused the same way', async () => {
    findKey.mockResolvedValue(keyRow(['lane:bast', 'scope-mode:enforce']));
    request('POST /api/api-keys');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
  });
  it('an unscoped admin key still reaches them', async () => {
    findKey.mockResolvedValue(keyRow([]));
    request('POST /api/api-keys');
    await expect(requireAuth()).resolves.toMatchObject({ userId: 'user-mike' });
    request('GET /api/admin/key-violations');
    await expect(requireAuth()).resolves.toMatchObject({ userId: 'user-mike' });
  });
  it('a lookalike path is not caught by the prefix rule', async () => {
    findKey.mockResolvedValue(keyRow(['lane:porter', 'scope-mode:enforce']));
    request('GET /api/api-keysX');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 }); // not in the lane either
    expect(createViolation).toHaveBeenCalledWith({ data: expect.objectContaining({ path: '/api/api-keysX', enforced: true }) });
  });
});

describe('violation cap and retention', () => {
  const v = (path: string) => ({ apiKeyId: 'key-cap', keyPrefix: 'citadel_0123abcd', lane: 'qbo', method: 'GET', path, enforced: false });

  it(`writes at most ${KEY_CAP_PER_MINUTE} rows per key per minute across distinct paths`, () => {
    const t = 1_000_000;
    let written = 0;
    for (let i = 0; i < 200; i++) if (recordKeyViolation(v(`/api/x/${i}`), t + i)) written++;
    expect(written).toBe(KEY_CAP_PER_MINUTE);
    expect(createViolation).toHaveBeenCalledTimes(KEY_CAP_PER_MINUTE);
    expect(recordKeyViolation(v('/api/x/new'), t + 61_000)).toBe(true);
    expect(recordKeyViolation({ ...v('/api/x/other'), apiKeyId: 'key-other' }, t + 100)).toBe(true);
  });

  it('deletes rows older than 30 days, at most once an hour', () => {
    const t = Date.parse('2026-11-30T12:00:00Z');
    recordKeyViolation(v('/api/a'), t);
    recordKeyViolation(v('/api/b'), t + 1000);
    expect(deleteOld).toHaveBeenCalledTimes(1);
    expect(deleteOld).toHaveBeenCalledWith({ where: { at: { lt: new Date(t - 30 * 24 * 60 * 60_000) } } });
    recordKeyViolation(v('/api/c'), t + 61 * 60_000);
    expect(deleteOld).toHaveBeenCalledTimes(2);
  });
});
