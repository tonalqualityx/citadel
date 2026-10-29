import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Designer Portal operator scopes (Mike, 2026-10-29): design:operator-setup and design:operator-publish are granted
// exactly like decisions:admin. Only a signed-in admin session grants them (never an API key, including one that
// already holds them); only on a key whose user is an admin; never beside a lane; removing them is always allowed.
vi.mock('@/lib/auth/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/auth/api-keys', () => ({ generateApiKey: vi.fn() }));
vi.mock('@/lib/services/activity', () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), logDelete: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { generateApiKey } from '@/lib/auth/api-keys';
import { POST } from '../route';
import { PATCH } from '../[id]/route';

const auth = requireAuth as Mock;
const findUser = prisma.user.findUnique as Mock;
const createKey = prisma.apiKey.create as Mock;
const findKey = prisma.apiKey.findUnique as Mock;
const updateKey = prisma.apiKey.update as Mock;

const BAST_KEY = '6cd749cc-b4e1-490d-8df8-2a34f87c9e9e';
const ADMIN = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'session' };
const ADMIN_KEY = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'api_key', apiKeyId: 'k-admin' };
// Bast's own key, already holding both operator scopes, trying to grant or keep them.
const OPERATOR_KEY = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'api_key', apiKeyId: BAST_KEY };
const OTHER_ID = '0b6e1c2a-1111-4222-8333-444455556666';

const post = (body: object) =>
  POST(new NextRequest('http://localhost:3000/api/api-keys', { method: 'POST', body: JSON.stringify(body) }));
const patch = (id: string, body: object) =>
  PATCH(new NextRequest(`http://localhost:3000/api/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  (generateApiKey as Mock).mockReturnValue({ rawKey: 'citadel_fake_raw', keyHash: 'h', keyPrefix: 'citadel_fake_ra' });
  createKey.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'key-new', name: data.name, key_prefix: data.key_prefix, expires_at: null, scopes: data.scopes, created_at: new Date(),
  }));
  updateKey.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: BAST_KEY, scopes: data.scopes }));
});

const SCOPES = ['design:operator-setup', 'design:operator-publish'] as const;

describe.each(SCOPES)('%s', (scope) => {
  it('mint: an admin session grants it on an admin key (201)', async () => {
    auth.mockResolvedValue(ADMIN);
    const res = await post({ name: 'Bast operator', scopes: [scope] });
    expect(res.status).toBe(201);
    expect(createKey.mock.calls[0][0].data.scopes).toEqual([scope]);
  });

  it('mint: any API key is 403 and nothing is created (a plain admin key, or the operator key itself, for itself or another admin)', async () => {
    for (const caller of [ADMIN_KEY, OPERATOR_KEY]) {
      auth.mockResolvedValue(caller);
      expect((await post({ name: 'self grant', scopes: [scope] })).status).toBe(403);
      findUser.mockResolvedValue({ id: OTHER_ID, is_active: true, role: 'admin' });
      expect((await post({ name: 'for other', scopes: [scope], user_id: OTHER_ID })).status).toBe(403);
    }
    expect(createKey).not.toHaveBeenCalled();
  });

  it('mint: beside a lane scope (incl. the design-worker lane) is 400', async () => {
    auth.mockResolvedValue(ADMIN);
    expect((await post({ name: 'lane', scopes: ['lane:bast', scope] })).status).toBe(400);
    expect((await post({ name: 'lane', scopes: ['lane:design-worker', 'scope-mode:enforce', scope] })).status).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });

  it('mint: for a non-admin owner is 400', async () => {
    auth.mockResolvedValue(ADMIN);
    for (const role of ['pm', 'tech']) {
      findUser.mockResolvedValue({ id: OTHER_ID, is_active: true, role });
      expect((await post({ name: 'x', scopes: [scope], user_id: OTHER_ID })).status).toBe(400);
    }
    expect(createKey).not.toHaveBeenCalled();
  });

  it('PATCH: an admin session grants it on an admin\'s key (200) and can take it away again (revocable)', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: BAST_KEY, name: 'Bast', scopes: [], is_revoked: false, user: { role: 'admin' } });
    expect((await patch(BAST_KEY, { scopes: [scope] })).status).toBe(200);
    expect(updateKey).toHaveBeenLastCalledWith(expect.objectContaining({ data: { scopes: [scope] } }));
    findKey.mockResolvedValue({ id: BAST_KEY, name: 'Bast', scopes: [scope], is_revoked: false, user: { role: 'admin' } });
    expect((await patch(BAST_KEY, { scopes: [] })).status).toBe(200);
    expect(updateKey).toHaveBeenLastCalledWith(expect.objectContaining({ data: { scopes: [] } }));
  });

  it('PATCH: an API key cannot grant it or even keep it (403, nothing updated); it may only drop it', async () => {
    for (const caller of [ADMIN_KEY, OPERATOR_KEY]) {
      auth.mockResolvedValue(caller);
      findKey.mockResolvedValue({ id: BAST_KEY, name: 'Bast', scopes: [...SCOPES], is_revoked: false, user: { role: 'admin' } });
      expect((await patch(BAST_KEY, { scopes: [scope] })).status).toBe(403);
      expect((await patch(BAST_KEY, { scopes: [...SCOPES] })).status).toBe(403);
      expect((await patch(BAST_KEY, { scopes: [scope, 'engine'] })).status).toBe(403);
    }
    expect(updateKey).not.toHaveBeenCalled();
    auth.mockResolvedValue(OPERATOR_KEY);
    expect((await patch(BAST_KEY, { scopes: [] })).status).toBe(200);
  });

  it('PATCH: onto a lane key 400, onto a non-admin user\'s key 400', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k-lane', name: 'dw', scopes: ['lane:design-worker', 'scope-mode:enforce'], is_revoked: false, user: { role: 'tech' } });
    expect((await patch('k-lane', { scopes: ['lane:design-worker', 'scope-mode:enforce', scope] })).status).toBe(400);
    findKey.mockResolvedValue({ id: 'k-pm', name: 'pm', scopes: [], is_revoked: false, user: { role: 'pm' } });
    expect((await patch('k-pm', { scopes: [scope] })).status).toBe(400);
    expect(updateKey).not.toHaveBeenCalled();
  });
});

describe('both operator scopes together', () => {
  it('an admin session puts both on Bast\'s key next to decisions:admin', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: BAST_KEY, name: 'Bast', scopes: ['decisions:admin'], is_revoked: false, user: { role: 'admin' } });
    const res = await patch(BAST_KEY, { scopes: ['decisions:admin', ...SCOPES] });
    expect(res.status).toBe(200);
    expect(updateKey).toHaveBeenCalledWith(expect.objectContaining({ data: { scopes: ['decisions:admin', ...SCOPES] } }));
  });
  it('a pm session cannot grant them (403)', async () => {
    auth.mockResolvedValue({ userId: 'pm-1', email: 'p@example.test', role: 'pm', via: 'session' });
    expect((await post({ name: 'x', scopes: [...SCOPES] })).status).toBe(403);
    expect((await patch(BAST_KEY, { scopes: [...SCOPES] })).status).toBe(403);
    expect(createKey).not.toHaveBeenCalled();
    expect(updateKey).not.toHaveBeenCalled();
  });
});
