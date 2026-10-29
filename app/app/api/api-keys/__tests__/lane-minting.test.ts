import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Fleet item 6: minting lane keys, minting for a service user, and flipping scopes (admin only).
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
import { logUpdate } from '@/lib/services/activity';
import { POST } from '../route';
import { PATCH, DELETE } from '../[id]/route';

const auth = requireAuth as Mock;
const findUser = prisma.user.findUnique as Mock;
const createKey = prisma.apiKey.create as Mock;
const findKey = prisma.apiKey.findUnique as Mock;
const updateKey = prisma.apiKey.update as Mock;

const ADMIN = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'session' };
// The same admin user calling with an API key instead of a signed-in session.
const ADMIN_KEY = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'api_key', apiKeyId: 'k-admin' };
const PM = { userId: 'pm-1', email: 'bast@example.test', role: 'pm' };
const BAST_ID = '0b6e1c2a-1111-4222-8333-444455556666';

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
});

describe('POST /api/api-keys lane scopes', () => {
  it('admin mints a shadow lane key', async () => {
    auth.mockResolvedValue(ADMIN);
    const res = await post({ name: 'courier', scopes: ['lane:courier'] });
    expect(res.status).toBe(201);
    expect((await res.json()).scopes).toEqual(['lane:courier']);
  });

  it('admin mints an enforce lane key', async () => {
    auth.mockResolvedValue(ADMIN);
    const res = await post({ name: 'courier', scopes: ['lane:courier', 'scope-mode:enforce'] });
    expect(res.status).toBe(201);
  });

  it('rejects unknown lanes, two lanes, enforce without a lane, engine plus lane, duplicates', async () => {
    auth.mockResolvedValue(ADMIN);
    for (const scopes of [
      ['lane:bogus'],
      ['lane:courier', 'lane:qbo'],
      ['scope-mode:enforce'],
      ['engine', 'lane:courier'],
      ['lane:courier', 'lane:courier'],
      ['scope-mode:shadow'],
    ]) {
      expect((await post({ name: 'x', scopes })).status).toBe(400);
    }
    expect(createKey).not.toHaveBeenCalled();
  });

  it('a pm cannot mint a lane key', async () => {
    auth.mockResolvedValue(PM);
    expect((await post({ name: 'x', scopes: ['lane:bast'] })).status).toBe(403);
    expect(createKey).not.toHaveBeenCalled();
  });
});

describe('the design-worker lane is born enforced (W8.2 H3)', () => {
  const WORKER_ID = '0b6e1c2a-2222-4222-8333-444455556666';
  it('minting lane:design-worker without scope-mode:enforce is 400 and creates nothing', async () => {
    auth.mockResolvedValue(ADMIN);
    findUser.mockResolvedValue({ id: WORKER_ID, is_active: true, role: 'tech' });
    const res = await post({ name: 'designer worker', user_id: WORKER_ID, scopes: ['lane:design-worker'] });
    expect(res.status).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });
  it('minting it with scope-mode:enforce is 201', async () => {
    auth.mockResolvedValue(ADMIN);
    findUser.mockResolvedValue({ id: WORKER_ID, is_active: true, role: 'tech' });
    const res = await post({ name: 'designer worker', user_id: WORKER_ID, scopes: ['lane:design-worker', 'scope-mode:enforce'] });
    expect(res.status).toBe(201);
    expect((await res.json()).scopes).toEqual(['lane:design-worker', 'scope-mode:enforce']);
  });
  it('PATCH cannot drop enforce from a design-worker key (400, nothing updated)', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k-w', user_id: WORKER_ID, is_revoked: false, scopes: ['lane:design-worker', 'scope-mode:enforce'], user: { role: 'tech' } });
    const res = await patch('k-w', { scopes: ['lane:design-worker'] });
    expect(res.status).toBe(400);
    expect(updateKey).not.toHaveBeenCalled();
  });
  it('other lanes keep shadow mode for their staged rollout', async () => {
    auth.mockResolvedValue(ADMIN);
    expect((await post({ name: 'oracle', scopes: ['lane:oracle'] })).status).toBe(201);
  });
});

describe('POST /api/api-keys user_id', () => {
  // Fleet wave B (item 6 finding 4): decisions:admin only on a no-lane key for an admin user.
  it('decisions:admin: allowed on a no-lane key for an admin; refused beside a lane or for a non-admin user', async () => {
    auth.mockResolvedValue(ADMIN);
    const ok = await post({ name: 'plain admin', scopes: ['decisions:admin'] });
    expect(ok.status).toBe(201);
    expect(createKey.mock.calls[0][0].data.scopes).toEqual(['decisions:admin']);

    createKey.mockClear();
    const lane = await post({ name: 'lane', scopes: ['lane:bast', 'decisions:admin'] });
    expect(lane.status).toBe(400);
    const enforced = await post({ name: 'lane', scopes: ['lane:bast', 'scope-mode:enforce', 'decisions:admin'] });
    expect(enforced.status).toBe(400);

    findUser.mockResolvedValue({ id: BAST_ID, is_active: true, role: 'pm' });
    const forBast = await post({ name: 'bast admin', scopes: ['decisions:admin'], user_id: BAST_ID });
    expect(forBast.status).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });

  it('decisions:admin: PATCH refuses a lane key and a non-admin key owner, allows an admin owner', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k1', name: 'n', scopes: [], is_revoked: false, user: { role: 'admin' } });
    updateKey.mockResolvedValue({ id: 'k1' });
    expect((await patch('k1', { scopes: ['lane:bast', 'decisions:admin'] })).status).toBe(400);
    expect((await patch('k1', { scopes: ['decisions:admin'] })).status).toBe(200);
    updateKey.mockClear();
    findKey.mockResolvedValue({ id: 'k2', name: 'n', scopes: [], is_revoked: false, user: { role: 'pm' } });
    expect((await patch('k2', { scopes: ['decisions:admin'] })).status).toBe(400);
    expect(updateKey).not.toHaveBeenCalled();
  });

  // Review finding: an admin API key must not grant decisions:admin, to itself or to any other key.
  it('decisions:admin: an admin API key cannot mint it (403, nothing created); other scopes still mint', async () => {
    auth.mockResolvedValue(ADMIN_KEY);
    const res = await post({ name: 'self grant', scopes: ['decisions:admin'] });
    expect(res.status).toBe(403);
    expect(createKey).not.toHaveBeenCalled();
    findUser.mockResolvedValue({ id: BAST_ID, is_active: true, role: 'admin' });
    expect((await post({ name: 'for other', scopes: ['decisions:admin'], user_id: BAST_ID })).status).toBe(403);
    expect(createKey).not.toHaveBeenCalled();
    expect((await post({ name: 'courier', scopes: ['lane:courier'] })).status).toBe(201);
  });

  it('decisions:admin: an admin API key cannot PATCH it onto itself or another key (403, nothing updated)', async () => {
    auth.mockResolvedValue(ADMIN_KEY);
    updateKey.mockResolvedValue({ id: 'k-admin' });
    findKey.mockResolvedValue({ id: 'k-admin', name: 'self', scopes: [], is_revoked: false, user: { role: 'admin' } });
    expect((await patch('k-admin', { scopes: ['decisions:admin'] })).status).toBe(403);
    findKey.mockResolvedValue({ id: 'k-other', name: 'other', scopes: [], is_revoked: false, user: { role: 'admin' } });
    expect((await patch('k-other', { scopes: ['decisions:admin'] })).status).toBe(403);
    expect(updateKey).not.toHaveBeenCalled();
    findKey.mockResolvedValue({ id: 'k-lane', name: 'lane', scopes: ['lane:bast'], is_revoked: false, user: { role: 'pm' } });
    expect((await patch('k-lane', { scopes: ['lane:bast', 'scope-mode:enforce'] })).status).toBe(200);
  });

  it('decisions:admin: an admin session may PATCH it onto an admin user\'s key', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k-other', name: 'other', scopes: [], is_revoked: false, user: { role: 'admin' } });
    updateKey.mockResolvedValue({ id: 'k-other', scopes: ['decisions:admin'] });
    expect((await patch('k-other', { scopes: ['decisions:admin'] })).status).toBe(200);
    expect(updateKey).toHaveBeenCalledWith(expect.objectContaining({ data: { scopes: ['decisions:admin'] } }));
  });

  it('admin mints a key for an active service user', async () => {
    auth.mockResolvedValue(ADMIN);
    findUser.mockResolvedValue({ id: BAST_ID, is_active: true });
    const res = await post({ name: 'worker', scopes: ['lane:bast'], user_id: BAST_ID });
    expect(res.status).toBe(201);
    expect(createKey).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: BAST_ID, scopes: ['lane:bast'] }) });
    expect((await res.json()).user_id).toBe(BAST_ID);
  });

  it('admin gets 404 for a missing or inactive user', async () => {
    auth.mockResolvedValue(ADMIN);
    findUser.mockResolvedValue({ id: BAST_ID, is_active: false });
    expect((await post({ name: 'w', user_id: BAST_ID })).status).toBe(404);
    findUser.mockResolvedValue(null);
    expect((await post({ name: 'w', user_id: BAST_ID })).status).toBe(404);
    expect(createKey).not.toHaveBeenCalled();
  });

  it('a pm key cannot mint with user_id (with or without scopes)', async () => {
    auth.mockResolvedValue(PM);
    expect((await post({ name: 'w', user_id: BAST_ID })).status).toBe(403);
    expect((await post({ name: 'w', user_id: BAST_ID, scopes: ['lane:bast'] })).status).toBe(403);
    expect((await post({ name: 'w', user_id: PM.userId })).status).toBe(400); // not a uuid
    expect(createKey).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
  });

  it('without user_id a pm still mints an unscoped key for itself', async () => {
    auth.mockResolvedValue(PM);
    expect((await post({ name: 'mine' })).status).toBe(201);
    expect(createKey).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 'pm-1', scopes: [] }) });
  });
});

describe('PATCH /api/api-keys/:id', () => {
  it('admin flips a lane key to enforce', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k1', name: 'courier', scopes: ['lane:courier'], is_revoked: false });
    updateKey.mockResolvedValue({ id: 'k1', scopes: ['lane:courier', 'scope-mode:enforce'] });
    const res = await patch('k1', { scopes: ['lane:courier', 'scope-mode:enforce'] });
    expect(res.status).toBe(200);
    expect(updateKey).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'k1' }, data: { scopes: ['lane:courier', 'scope-mode:enforce'] } }));
    expect(logUpdate).toHaveBeenCalled();
  });

  it('a pm key cannot PATCH scopes', async () => {
    auth.mockResolvedValue(PM);
    const res = await patch('k1', { scopes: ['lane:courier'] });
    expect(res.status).toBe(403);
    expect(findKey).not.toHaveBeenCalled();
    expect(updateKey).not.toHaveBeenCalled();
  });

  it('404 for a revoked or missing key; 400 for bad scopes or extra fields', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k1', name: 'x', scopes: [], is_revoked: true });
    expect((await patch('k1', { scopes: ['lane:courier'] })).status).toBe(404);
    findKey.mockResolvedValue(null);
    expect((await patch('k1', { scopes: ['lane:courier'] })).status).toBe(404);
    expect((await patch('k1', { scopes: ['lane:bogus'] })).status).toBe(400);
    expect((await patch('k1', { scopes: ['lane:courier'], user_id: BAST_ID })).status).toBe(400);
    expect(updateKey).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/api-keys/:id (revoke)', () => {
  const del = (id: string) =>
    DELETE(new NextRequest(`http://localhost:3000/api/api-keys/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

  it('an admin may revoke any key, including a service user\'s lane key', async () => {
    auth.mockResolvedValue(ADMIN);
    findKey.mockResolvedValue({ id: 'k-bast', user_id: BAST_ID, name: 'lane:courier (bast)' });
    updateKey.mockResolvedValue({});
    expect((await del('k-bast')).status).toBe(200);
    expect(updateKey).toHaveBeenCalledWith({ where: { id: 'k-bast' }, data: { is_revoked: true } });
  });

  it('a pm may revoke only its own keys', async () => {
    auth.mockResolvedValue(PM);
    findKey.mockResolvedValue({ id: 'k-bast', user_id: BAST_ID, name: 'x' });
    expect((await del('k-bast')).status).toBe(403);
    expect(updateKey).not.toHaveBeenCalled();
    findKey.mockResolvedValue({ id: 'k-own', user_id: 'pm-1', name: 'mine' });
    updateKey.mockResolvedValue({});
    expect((await del('k-own')).status).toBe(200);
  });
});

// Designer Portal (design D1): no API key is ever minted for a designer.
describe('POST /api/api-keys designer owner', () => {
  const DESIGNER = { userId: 'designer-1', email: 'lisa@example.test', role: 'designer', via: 'session' };
  const LISA_ID = '7c1d2e3f-1111-4222-8333-444455556666';

  it('a designer minting for herself is 400, nothing created', async () => {
    auth.mockResolvedValue(DESIGNER);
    const res = await post({ name: 'mine' });
    expect(res.status).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });

  it('an admin minting for a designer with user_id is 400, with or without scopes', async () => {
    auth.mockResolvedValue(ADMIN);
    findUser.mockResolvedValue({ id: LISA_ID, is_active: true, role: 'designer' });
    expect((await post({ name: 'for lisa', user_id: LISA_ID })).status).toBe(400);
    expect((await post({ name: 'for lisa', user_id: LISA_ID, scopes: ['lane:courier'] })).status).toBe(400);
    expect(createKey).not.toHaveBeenCalled();
  });
});
