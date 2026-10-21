import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/chat/switches', () => ({ chatAvailability: vi.fn().mockResolvedValue({ available: false, reason: 'mode_off' }) }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { site: { findMany: vi.fn() }, project: { findMany: vi.fn() }, charter: { findMany: vi.fn() } },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';

const req = () => new NextRequest(new URL('http://localhost/api/portal/intake/context'));

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.site.findMany as Mock).mockResolvedValue([]);
  (prisma.project.findMany as Mock).mockResolvedValue([]);
  (prisma.charter.findMany as Mock).mockResolvedValue([]);
});

describe('GET /api/portal/intake/context', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await GET(req())).status).toBe(401);
    expect(prisma.site.findMany).not.toHaveBeenCalled();
  });

  it('returns sites, open builds and charters for a member, scoped to the client', async () => {
    (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'member' });
    (prisma.site.findMany as Mock).mockResolvedValue([
      { id: 's1', name: 'example.com', maintenance_plan_id: 'mp', hosting_plan_id: null },
      { id: 's2', name: 'two.com', maintenance_plan_id: null, hosting_plan_id: null },
    ]);
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: 'p1', name: 'Relaunch', site_id: null, status: 'in_progress', scope_locked: false }]);
    (prisma.charter.findMany as Mock).mockResolvedValue([
      {
        id: 'ch1',
        name: 'INTERNAL CHARTER NAME',
        site_id: null,
        status: 'active',
        start_date: new Date('2026-01-01'),
        end_date: null,
        created_at: new Date('2026-01-01'),
        charter_wares: [{ ware: { name: 'SEO' } }, { ware: { name: 'Social' } }],
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_request).toBe(true);
    expect(body.sites).toEqual([
      { id: 's1', name: 'example.com', has_plan: true },
      { id: 's2', name: 'two.com', has_plan: false },
    ]);
    expect(body.open_builds).toHaveLength(1);
    expect(body.charters[0]).toMatchObject({ id: 'ch1', label: 'SEO, Social', status: 'active' });
    expect(JSON.stringify(body)).not.toContain('INTERNAL CHARTER NAME');

    expect((prisma.site.findMany as Mock).mock.calls[0][0].where).toMatchObject({ client_id: 'cl1', is_deleted: false });
    const projWhere = (prisma.project.findMany as Mock).mock.calls[0][0].where;
    expect(projWhere.client_id).toBe('cl1');
    expect(projWhere.status).toEqual({ in: ['ready', 'in_progress', 'review'] });
    expect(JSON.stringify(projWhere)).toContain('"portal_visibility":{"not":"hidden"}');
    expect((prisma.charter.findMany as Mock).mock.calls[0][0].where).toMatchObject({ client_id: 'cl1', status: { in: ['active', 'paused'] } });
  });

  it('lets a viewer see the context and request', async () => {
    (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
    const body = await (await GET(req())).json();
    expect(body.can_request).toBe(true);
  });

  it('tells a grant-only contact it cannot request and reads nothing', async () => {
    (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'none' });
    const body = await (await GET(req())).json();
    expect(body).toEqual({ can_request: false, sites: [], open_builds: [], charters: [] });
    expect(prisma.site.findMany).not.toHaveBeenCalled();
  });
});
