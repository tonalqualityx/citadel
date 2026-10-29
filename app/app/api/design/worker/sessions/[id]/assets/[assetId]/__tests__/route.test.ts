import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { GET } from '../route';
import { getRequest, SESSION_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/design/worker-kit', () => ({ requireWorker: vi.fn(async () => ({ userId: 'w', role: 'admin', via: 'api_key' })) }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { designSession: { findUnique: vi.fn() }, designAsset: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() } } }));
// Mirrors the real private store: keys must start with portal-private/ or the call throws.
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

import { prisma } from '@/lib/db/prisma';
import { storeAsset } from '@/lib/design/assets';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let assetId = '';
const call = (id = assetId, sid = SESSION_ID) => GET(getRequest(`/x`) as unknown as Request, { params: Promise.resolve({ id: sid, assetId: id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  objects.clear();
  (prisma.designSession.findUnique as Mock).mockResolvedValue({ id: SESSION_ID });
  (prisma.designAsset.count as Mock).mockResolvedValue(0);
  (prisma.designAsset.create as Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  const stored = await storeAsset({ sessionId: SESSION_ID, kind: 'crop', bytes: PNG }, prisma as unknown as PrismaClient);
  assetId = stored.id;
  (prisma.designAsset.findFirst as Mock).mockImplementation(async ({ where }: { where: { id: string; session_id: string } }) =>
    where.id === stored.id && where.session_id === SESSION_ID ? stored : null);
});

describe('GET /api/design/worker/sessions/:id/assets/:assetId', () => {
  it('reads back an asset the worker just uploaded through storeAsset', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });
  it('404 for an unknown asset, a malformed id, and another session', async () => {
    expect((await call('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
    expect((await call(assetId, '66666666-6666-4666-8666-666666666666')).status).toBe(404);
  });
});
