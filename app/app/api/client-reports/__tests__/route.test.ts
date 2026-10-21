import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
    charter: { findFirst: vi.fn() },
    site: { findFirst: vi.fn() },
    clientReport: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const CL = '11111111-1111-4111-8111-111111111111';
const CH = '22222222-2222-4222-8222-222222222222';
const body = (over: Record<string, unknown> = {}) => ({ client_id: CL, period: '2026-10', title: 'October report', headline: 'Calls are up.', url: 'https://reports.example.com/oct', published_at: '2026-10-21T12:00:00Z', ...over });
const post = (b: unknown) => POST(new NextRequest(new URL('http://localhost/api/client-reports'), { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'steward', role: 'pm' });
  p.client.findFirst.mockResolvedValue({ id: CL });
  p.charter.findFirst.mockResolvedValue({ id: CH });
  p.site.findFirst.mockResolvedValue({ id: 's1' });
  p.clientReport.findUnique.mockResolvedValue(null);
  p.clientReport.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data }));
  p.clientReport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data }));
});

describe('POST /api/client-reports', () => {
  it('is pm and admin only', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u', role: 'tech' });
    expect((await post(body())).status).toBe(403);
  });
  it('creates a report (201) and upserts by url (200)', async () => {
    const created = await post(body({ charter_id: CH }));
    expect(created.status).toBe(201);
    expect(p.clientReport.create.mock.calls[0][0].data).toMatchObject({ client_id: CL, charter_id: CH, period: '2026-10', url: 'https://reports.example.com/oct', published_at: new Date('2026-10-21T12:00:00Z') });
    p.clientReport.findUnique.mockResolvedValue({ id: 'r1', client_id: CL });
    const again = await post(body({ title: 'October report v2' }));
    expect(again.status).toBe(200);
    expect(p.clientReport.update.mock.calls[0][0].data.title).toBe('October report v2');
  });
  it('409s a url that belongs to another client', async () => {
    p.clientReport.findUnique.mockResolvedValue({ id: 'r1', client_id: 'someone-else' });
    expect((await post(body())).status).toBe(409);
    expect(p.clientReport.update).not.toHaveBeenCalled();
  });
  it('rejects a non-web url, a bad period, and a charter or site from another client', async () => {
    expect((await post(body({ url: 'javascript:alert(1)' }))).status).toBe(400);
    expect((await post(body({ period: '2026-13' }))).status).toBe(400);
    p.charter.findFirst.mockResolvedValue(null);
    expect((await post(body({ charter_id: CH }))).status).toBe(404);
    p.site.findFirst.mockResolvedValue(null);
    expect((await post(body({ site_id: CH }))).status).toBe(404);
    expect(p.clientReport.create).not.toHaveBeenCalled();
  });
  it('a report without published_at is stored unpublished', async () => {
    await post(body({ published_at: undefined }));
    expect(p.clientReport.create.mock.calls[0][0].data.published_at).toBeNull();
  });
});
