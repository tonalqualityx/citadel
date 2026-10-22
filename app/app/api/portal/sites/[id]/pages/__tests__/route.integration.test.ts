import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/client-auth', () => ({ requireClientAuth: vi.fn() }));
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: () => null, portalReadRateLimit: () => null }));

import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { GET } from '../route';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';

const auth = vi.mocked(requireClientAuth);
const call = (siteId: string, q?: string) =>
  GET(new NextRequest(`http://localhost/api/portal/sites/${siteId}/pages${q ? `?q=${q}` : ''}`), { params: Promise.resolve({ id: siteId }) });

describe.skipIf(!SCRATCH)('GET /api/portal/sites/:id/pages (real database)', () => {
  const tag = `ps${Date.now()}`;
  let a: Seeded;
  let b: Seeded;
  beforeAll(async () => {
    a = await seedClient(`${tag}a`);
    b = await seedClient(`${tag}b`);
    const mk = (s: Seeded, path: string, title: string) =>
      prisma.sitePage.create({ data: { site_id: s.siteId, url: `https://x.test${path}`, path, title, depth: 1, source: 'sitemap', last_seen_at: new Date() } });
    await mk(a, '/about', 'About us');
    await mk(a, '/contact', 'Contact');
    await mk(b, '/secret', 'Bravo secret');
  });
  afterAll(async () => {
    await cleanup([a, b]);
    await prisma.$disconnect();
  });
  const as = (s: Seeded, contactId: string, role: 'owner' | 'viewer' | 'none') =>
    auth.mockResolvedValue({ contactId, clientId: s.clientId, role, contactIds: [contactId] } as never);

  it('lists and searches the signed-in client\'s own site', async () => {
    as(a, a.ownerId, 'owner');
    const all = await (await call(a.siteId)).json();
    expect(all.pages.map((p: { title: string }) => p.title).sort()).toEqual(['About us', 'Contact']);
    const hit = await (await call(a.siteId, 'abou')).json();
    expect(hit.pages).toHaveLength(1);
    expect(hit.pages[0]).toMatchObject({ title: 'About us', path: '/about' });
  });

  it('another client\'s site, a bad id and a project-only contact are all 404', async () => {
    as(a, a.ownerId, 'owner');
    expect((await call(b.siteId)).status).toBe(404);
    expect((await call('not-a-uuid')).status).toBe(404);
    as(a, a.viewerId, 'none');
    expect((await call(a.siteId)).status).toBe(404);
  });

  it('a viewer may search', async () => {
    as(a, a.viewerId, 'viewer');
    expect((await call(a.siteId)).status).toBe(200);
  });
});
