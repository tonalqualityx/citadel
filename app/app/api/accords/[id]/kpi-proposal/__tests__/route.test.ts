import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { accord: { findUnique: vi.fn(), update: vi.fn() } } }));

import { GET, PUT } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const ID = '44444444-4444-4444-8444-444444444444';
const ctx = { params: Promise.resolve({ id: ID }) };
const put = (body: unknown) => new NextRequest(`http://localhost/api/accords/${ID}/kpi-proposal`, { method: 'PUT', body: JSON.stringify(body) });
const get = () => new NextRequest(`http://localhost/api/accords/${ID}/kpi-proposal`);
const item = { metric: 'sessions', label: 'More visits', direction: 'up', source: 'ga4' };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm', email: 'x@y.z' });
  (requireRole as Mock).mockImplementation(() => {});
  p.accord.findUnique.mockResolvedValue({ id: ID, kpi_proposal: null });
});

describe('/api/accords/[id]/kpi-proposal', () => {
  it('refuses without a session (401) and for non-staff (403)', async () => {
    (requireAuth as Mock).mockRejectedValueOnce(new AuthError('Authentication required', 401));
    expect((await GET(get(), ctx)).status).toBe(401);
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await PUT(put({ kpi_proposal: [item] }), ctx)).status).toBe(403);
    expect(p.accord.update).not.toHaveBeenCalled();
  });
  it('GET returns the stored proposal, null when none', async () => {
    expect(await (await GET(get(), ctx)).json()).toEqual({ accord_id: ID, kpi_proposal: null });
    p.accord.findUnique.mockResolvedValue({ id: ID, kpi_proposal: [item] });
    expect((await (await GET(get(), ctx)).json()).kpi_proposal).toEqual([item]);
  });
  it('GET 404s for an unknown accord', async () => {
    p.accord.findUnique.mockResolvedValue(null);
    expect((await GET(get(), ctx)).status).toBe(404);
  });
  it('PUT stores a valid proposal (cleaned)', async () => {
    const res = await PUT(put({ kpi_proposal: [{ ...item, junk: 1 }] }), ctx);
    expect(res.status).toBe(200);
    expect(p.accord.update.mock.calls[0][0]).toMatchObject({ where: { id: ID }, data: { kpi_proposal: [item] } });
  });
  it('PUT refuses an invalid proposal with the list of problems', async () => {
    const res = await PUT(put({ kpi_proposal: [{ ...item, direction: 'x' }] }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_proposal');
    expect(body.details[0]).toMatch(/direction/);
    expect(p.accord.update).not.toHaveBeenCalled();
    expect((await PUT(put({}), ctx)).status).toBe(400);
  });
});
