import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, signIn, anonymous, sessionRow, SESSION_ID, OTHER_DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, designSession: { findUnique: vi.fn() }, designAsset: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() } } }));
// Mirrors the real private store: keys must start with portal-private/ or the call throws (s3.ts assertPrivateKey).
const objects = new Map<string, Buffer>();
vi.mock('@/lib/services/s3', async (orig) => {
  const real = await orig<typeof import('@/lib/services/s3')>();
  const check = (key: string) => {
    if (!key.startsWith(real.PRIVATE_PREFIX)) throw new Error('Private objects live under ' + real.PRIVATE_PREFIX);
  };
  return {
    ...real,
    putPrivateObject: vi.fn(async (key: string, buf: Buffer) => { check(key); objects.set(key, buf); }),
    getPrivateObject: vi.fn(async (key: string) => { check(key); const b = objects.get(key); if (!b) throw new Error('NoSuchKey'); return b; }),
  };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { getPrivateObject } from '@/lib/services/s3';
import { storeAsset } from '@/lib/design/assets';
import type { PrismaClient } from '@prisma/client';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const assetFind = prisma.designAsset.findFirst as Mock;
const storage = getPrivateObject as Mock;
let ASSET = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const call = (assetId = ASSET) =>
  GET(getRequest(`/api/design/sessions/${SESSION_ID}/assets/${assetId}`), { params: Promise.resolve({ id: SESSION_ID, assetId }) });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(async () => {
  vi.clearAllMocks();
  (prisma.designSession.findUnique as Mock).mockResolvedValue(sessionRow());
  objects.clear();
  // Seed through the real storeAsset so the row's storage_key is exactly what production writes.
  (prisma.designSession.findUnique as Mock).mockResolvedValue(sessionRow());
  (prisma.designAsset.count as Mock).mockResolvedValue(0);
  (prisma.designAsset.create as Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  const stored = await storeAsset({ sessionId: SESSION_ID, kind: 'crop', bytes: PNG }, prisma as unknown as PrismaClient);
  ASSET = stored.id;
  assetFind.mockResolvedValue(stored);
});

describe('GET /api/design/sessions/:id/assets/:assetId', () => {
  it('serves the bytes with the stored type and the hardening headers', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
    expect(assetFind).toHaveBeenCalledWith({ where: { id: ASSET, session_id: SESSION_ID } });
    expect(storage).toHaveBeenCalledWith(`portal-private/design/${SESSION_ID}/${ASSET}`);
  });
  it('text assets are served as text/plain only, anything odd as octet-stream', async () => {
    signIn(auth, userFind, 'designer');
    objects.set(`portal-private/design/x/y`, Buffer.from('hi'));
    assetFind.mockResolvedValue({ id: ASSET, content_type: 'text/html', storage_key: 'design/x/y' });
    expect((await call()).headers.get('content-type')).toBe('text/plain; charset=utf-8');
    assetFind.mockResolvedValue({ id: ASSET, content_type: 'image/svg+xml', storage_key: 'design/x/y' });
    expect((await call()).headers.get('content-type')).toBe('application/octet-stream');
  });
  it('404 for another designer, an asset of another session, a missing file, a malformed id; pm and admin may read; anonymous 401', async () => {
    signIn(auth, userFind, 'designer', { userId: OTHER_DESIGNER_ID });
    expect((await call()).status).toBe(404);
    signIn(auth, userFind, 'designer');
    assetFind.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    assetFind.mockResolvedValue({ id: ASSET, content_type: 'image/png', storage_key: 'k' });
    expect((await call()).status).toBe(404); // row exists, object missing
    expect((await call('nope')).status).toBe(404);
    objects.set('portal-private/k', PNG);
    assetFind.mockResolvedValue({ id: ASSET, session_id: SESSION_ID, content_type: 'image/png', storage_key: 'k' });
    signIn(auth, userFind, 'pm');
    expect((await call()).status).toBe(200);
    signIn(auth, userFind, 'admin');
    expect((await call()).status).toBe(200);
    anonymous(auth);
    expect((await call()).status).toBe(401);
  });
});
