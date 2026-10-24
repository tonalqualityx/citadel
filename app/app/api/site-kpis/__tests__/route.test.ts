import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
    site: { findFirst: vi.fn() },
    accord: { findFirst: vi.fn() },
    charter: { findFirst: vi.fn() },
    siteKpi: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { GET, POST } from '../route';
import { GET as GET_ONE, PATCH, DELETE } from '../[id]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const CL = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const row = (over = {}) => ({
  id: ID, client_id: CL, site_id: null, accord_id: null, charter_id: null, metric: 'sessions', label: 'More visits', direction: 'up',
  baseline_value: null, baseline_at: null, target_value: '1500.00', target_by: new Date('2027-03-31T00:00:00Z'), source: 'ga4',
  status: 'proposed', confirmed_at: null, last_value: null, last_checked_at: null, created_at: new Date(), updated_at: new Date(), ...over,
});
const json = (url: string, method: string, body?: object) =>
  new NextRequest(`http://localhost${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm', email: 'x@y.z' });
  (requireRole as Mock).mockImplementation(() => {});
  p.client.findFirst.mockResolvedValue({ id: CL });
});

describe('staff auth', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['GET list', () => GET(json(`/api/site-kpis?client_id=${CL}`, 'GET'))],
    ['POST', () => POST(json('/api/site-kpis', 'POST', {}))],
    ['GET one', () => GET_ONE(json(`/api/site-kpis/${ID}`, 'GET'), ctx)],
    ['PATCH', () => PATCH(json(`/api/site-kpis/${ID}`, 'PATCH', {}), ctx)],
    ['DELETE', () => DELETE(json(`/api/site-kpis/${ID}`, 'DELETE'), ctx)],
  ];
  it.each(calls)('%s answers 401 without a session', async (_n, fn) => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await fn()).status).toBe(401);
    expect(p.siteKpi.create).not.toHaveBeenCalled();
  });
  it.each(calls)('%s answers 403 for a non-staff role', async (_n, fn) => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await fn()).status).toBe(403);
    expect(p.siteKpi.create).not.toHaveBeenCalled();
    expect(p.siteKpi.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/site-kpis', () => {
  it('needs client_id or site_id', async () => {
    expect((await GET(json('/api/site-kpis', 'GET'))).status).toBe(400);
  });
  it('lists non-retired rows by default, numbers as numbers', async () => {
    p.siteKpi.findMany.mockResolvedValue([row()]);
    const res = await GET(json(`/api/site-kpis?client_id=${CL}`, 'GET'));
    expect(res.status).toBe(200);
    expect(p.siteKpi.findMany.mock.calls[0][0].where).toMatchObject({ client_id: CL, status: { not: 'retired' } });
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ target_value: 1500, target_by: '2027-03-31' });
  });
});

describe('POST /api/site-kpis', () => {
  const good = { client_id: CL, metric: 'sessions', label: 'More visits', direction: 'up', source: 'ga4', target_value: 1500, target_by: '2027-03-31' };
  it('creates a proposed row by default', async () => {
    p.siteKpi.create.mockResolvedValue(row());
    const res = await POST(json('/api/site-kpis', 'POST', good));
    expect(res.status).toBe(201);
    expect(p.siteKpi.create.mock.calls[0][0].data).toMatchObject({ status: 'proposed', confirmed_at: null, client_id: CL });
  });
  it('stamps confirmed_at when created confirmed', async () => {
    p.siteKpi.create.mockResolvedValue(row({ status: 'confirmed' }));
    await POST(json('/api/site-kpis', 'POST', { ...good, status: 'confirmed' }));
    const data = p.siteKpi.create.mock.calls[0][0].data;
    expect(data.status).toBe('confirmed');
    expect(data.confirmed_at).toBeInstanceOf(Date);
  });
  it('refuses a bad body and a site that is not the client\'s', async () => {
    expect((await POST(json('/api/site-kpis', 'POST', { ...good, direction: 'left' }))).status).toBe(400);
    p.site.findFirst.mockResolvedValue(null);
    const res = await POST(json('/api/site-kpis', 'POST', { ...good, site_id: '22222222-2222-4222-8222-222222222222' }));
    expect(res.status).toBe(400);
    expect(p.siteKpi.create).not.toHaveBeenCalled();
  });
});

describe('/api/site-kpis/[id]', () => {
  it('404s for a missing row or a bad id', async () => {
    p.siteKpi.findUnique.mockResolvedValue(null);
    expect((await GET_ONE(json(`/api/site-kpis/${ID}`, 'GET'), ctx)).status).toBe(404);
    expect((await GET_ONE(json('/api/site-kpis/x', 'GET'), { params: Promise.resolve({ id: 'x' }) })).status).toBe(404);
  });
  it('PATCH edits fields and stamps confirmed_at on first confirmation', async () => {
    p.siteKpi.findUnique.mockResolvedValue(row());
    p.siteKpi.update.mockResolvedValue(row({ status: 'confirmed' }));
    const res = await PATCH(json(`/api/site-kpis/${ID}`, 'PATCH', { status: 'confirmed', last_value: 1200 }), ctx);
    expect(res.status).toBe(200);
    const data = p.siteKpi.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'confirmed', last_value: 1200 });
    expect(data.confirmed_at).toBeInstanceOf(Date);
  });
  it('PATCH refuses fields it does not own (metric, client)', async () => {
    p.siteKpi.findUnique.mockResolvedValue(row());
    expect((await PATCH(json(`/api/site-kpis/${ID}`, 'PATCH', { metric: 'leads' }), ctx)).status).toBe(400);
    expect((await PATCH(json(`/api/site-kpis/${ID}`, 'PATCH', { client_id: CL }), ctx)).status).toBe(400);
    expect(p.siteKpi.update).not.toHaveBeenCalled();
  });
  it('DELETE retires the row and never deletes', async () => {
    p.siteKpi.findUnique.mockResolvedValue(row({ status: 'confirmed' }));
    p.siteKpi.update.mockResolvedValue(row({ status: 'retired' }));
    const res = await DELETE(json(`/api/site-kpis/${ID}`, 'DELETE'), ctx);
    expect(res.status).toBe(200);
    expect(p.siteKpi.update.mock.calls[0][0]).toMatchObject({ where: { id: ID }, data: { status: 'retired' } });
    expect((await res.json()).status).toBe('retired');
    expect(p.siteKpi).not.toHaveProperty('delete');
  });
});
