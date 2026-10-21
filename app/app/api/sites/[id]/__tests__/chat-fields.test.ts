import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn((u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) { const e = new Error('Insufficient permissions') as Error & { statusCode: number }; e.name = 'AuthError'; e.statusCode = 403; throw e; } }) }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { site: { update: vi.fn() } } }));

import { PATCH } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const patch = (body: object) =>
  PATCH(new NextRequest('http://localhost/api/sites/s1', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 's1' }) });
const update = prisma.site.update as Mock;

describe('PATCH /api/sites/:id chat fields (portal phase C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({ id: 's1', name: 'S', portal_chat_enabled: true, ga4_property: 'properties/1', gsc_property: 'sc-domain:x.com', domains: [] });
  });

  it('an admin sets the switch and both ids; they come back in the response', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a1', role: 'admin', email: 'a@x' } as never);
    const res = await patch({ portal_chat_enabled: true, ga4_property: 'properties/1', gsc_property: 'sc-domain:x.com' });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toMatchObject({ portal_chat_enabled: true, ga4_property: 'properties/1', gsc_property: 'sc-domain:x.com' });
    expect(await res.json()).toMatchObject({ portal_chat_enabled: true, ga4_property: 'properties/1', gsc_property: 'sc-domain:x.com' });
  });

  it('the Bast user may write them (the backfill)', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: BAST_USER_ID, role: 'pm', email: 'b@x' } as never);
    expect((await patch({ ga4_property: 'properties/1' })).status).toBe(200);
  });

  it('another pm may not, but may still change ordinary fields', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'pm1', role: 'pm', email: 'p@x' } as never);
    expect((await patch({ portal_chat_enabled: true })).status).toBe(403);
    expect((await patch({ gsc_property: null })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect((await patch({ name: 'Renamed' })).status).toBe(200);
  });

  it('rejects malformed ids', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a1', role: 'admin', email: 'a@x' } as never);
    expect((await patch({ ga4_property: '362082877' })).status).toBe(400);
    expect((await patch({ gsc_property: 'herbapumps.com' })).status).toBe(400);
  });
});
