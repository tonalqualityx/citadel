import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';
import { GET as GET_ONE, PATCH } from '../[id]/route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    recurringWork: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    charter: { findFirst: vi.fn() },
    sop: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    client: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    initiative: { findFirst: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const SOP = U(1), CHARTER = U(2), CLIENT = U(3), SITE = U(4), OWNER = U(5), INIT = U(6), RW = U(7);

const req = (method: string, body?: object, url = 'http://localhost/api/recurring-work') =>
  new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const ctx = { params: Promise.resolve({ id: RW }) };

const stored = (o: Record<string, unknown> = {}) => ({
  id: RW, kind: 'citadel_task', title: null, charter_id: null, charter_ware_id: null, sop_id: SOP, sop: { id: SOP, title: 'Monthly report' },
  cadence: 'monthly', cron_expr: null, job_key: null, source_kind: null, source_id: null, owner_id: null, client_id: null, site_id: null,
  initiative_id: null, is_plumbing: false, paused_on_purpose: false, sort_order: 0, is_active: true,
  created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-01'), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: OWNER, email: 'm@x.com', role: 'admin' });
  (requireRole as Mock).mockReturnValue(undefined);
  p.recurringWork.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => stored(data));
  p.recurringWork.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => stored(data));
  p.recurringWork.findUnique.mockResolvedValue(stored());
  p.sop.findUnique.mockResolvedValue({ id: SOP });
  p.user.findUnique.mockResolvedValue({ id: OWNER });
  p.client.findUnique.mockResolvedValue({ id: CLIENT });
  p.site.findUnique.mockResolvedValue({ id: SITE });
  p.initiative.findFirst.mockResolvedValue({ id: INIT });
  p.charter.findFirst.mockResolvedValue({ id: CHARTER, client_id: CLIENT, site_id: SITE });
});

describe('GET /api/recurring-work', () => {
  it('hides plumbing by default and returns the title from the SOP', async () => {
    p.recurringWork.findMany.mockResolvedValue([stored()]);
    const res = await GET(req('GET'));
    const body = await res.json();
    expect(p.recurringWork.findMany.mock.calls[0][0].where).toEqual({ is_plumbing: false });
    expect(body.total).toBe(1);
    expect(body.recurring_work[0]).toMatchObject({ id: RW, kind: 'citadel_task', title: 'Monthly report', cadence: 'monthly' });
  });

  it('applies every filter, and include_plumbing=true lifts the plumbing filter', async () => {
    p.recurringWork.findMany.mockResolvedValue([]);
    const qs = `kind=machine_job&client_id=${CLIENT}&charter_id=${CHARTER}&initiative_id=${INIT}&owner_id=${OWNER}&is_active=false&include_plumbing=true`;
    await GET(req('GET', undefined, `http://localhost/api/recurring-work?${qs}`));
    expect(p.recurringWork.findMany.mock.calls[0][0].where).toEqual({
      kind: 'machine_job', charter_id: CHARTER, initiative_id: INIT, owner_id: OWNER, is_active: false,
      OR: [{ charter_id: null, client_id: CLIENT }, { charter: { client_id: CLIENT } }],
    });
  });

  it('a charter row shows its charter\'s current client and site, so a charter that changes client moves its rows', async () => {
    const B = U(9);
    p.recurringWork.findMany.mockResolvedValue([
      stored({ charter_id: CHARTER, client_id: null, site_id: null, charter: { id: CHARTER, name: 'Care plan', client_id: B, site_id: SITE, client: { id: B, name: 'Client B' }, site: { id: SITE, name: 'b.com' } } }),
    ]);
    const body = await (await GET(req('GET', undefined, `http://localhost/api/recurring-work?client_id=${B}`))).json();
    expect(body.recurring_work[0]).toMatchObject({ client_id: B, client: { id: B, name: 'Client B' }, site_id: SITE, charter: { id: CHARTER, name: 'Care plan' } });
    expect(body.recurring_work[0].charter).toEqual({ id: CHARTER, name: 'Care plan' });
  });

  it('400 for an unknown kind', async () => {
    const res = await GET(req('GET', undefined, 'http://localhost/api/recurring-work?kind=nope'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/recurring-work', () => {
  it('citadel_task requires sop_id and cadence', async () => {
    expect((await POST(req('POST', { kind: 'citadel_task', cadence: 'monthly' }))).status).toBe(400);
    expect((await POST(req('POST', { sop_id: SOP }))).status).toBe(400);
    const ok = await POST(req('POST', { sop_id: SOP, cadence: 'weekly' }));
    expect(ok.status).toBe(201);
    expect(p.recurringWork.create.mock.calls[0][0].data.kind).toBe('citadel_task');
  });

  it('rejects a cadence outside the charter values', async () => {
    expect((await POST(req('POST', { sop_id: SOP, cadence: 'daily' }))).status).toBe(400);
  });

  it('machine_job requires cron_expr and job_key', async () => {
    expect((await POST(req('POST', { kind: 'machine_job', cron_expr: '0 7 * * *' }))).status).toBe(400);
    expect((await POST(req('POST', { kind: 'machine_job', job_key: 'x' }))).status).toBe(400);
    expect((await POST(req('POST', { kind: 'machine_job', cron_expr: '0 7 * * *', job_key: 'daily-thing', title: 'Daily thing' }))).status).toBe(201);
  });

  it('engine requires source_kind and source_id, with a known source_kind', async () => {
    expect((await POST(req('POST', { kind: 'engine', source_kind: 'troubador_schedule' }))).status).toBe(400);
    expect((await POST(req('POST', { kind: 'engine', source_kind: 'other', source_id: INIT }))).status).toBe(400);
    expect((await POST(req('POST', { kind: 'engine', source_kind: 'maintenance_plan', source_id: INIT }))).status).toBe(201);
  });

  it('a charter row stores no client or site of its own (they are the charter\'s)', async () => {
    await POST(req('POST', { sop_id: SOP, cadence: 'monthly', charter_id: CHARTER }));
    const data = p.recurringWork.create.mock.calls[0][0].data;
    expect(data.charter_id).toBe(CHARTER);
    expect(data.client_id ?? null).toBeNull();
    expect(data.site_id ?? null).toBeNull();
  });

  it('400 when a charter row is sent with its own client or site', async () => {
    expect((await POST(req('POST', { sop_id: SOP, cadence: 'monthly', charter_id: CHARTER, client_id: CLIENT }))).status).toBe(400);
    expect((await POST(req('POST', { sop_id: SOP, cadence: 'monthly', charter_id: CHARTER, site_id: SITE }))).status).toBe(400);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });

  it.each([
    ['charter', () => p.charter.findFirst, { charter_id: CHARTER }],
    ['sop', () => p.sop.findUnique, {}],
    ['owner', () => p.user.findUnique, { owner_id: OWNER }],
    ['client', () => p.client.findUnique, { client_id: CLIENT }],
    ['site', () => p.site.findUnique, { site_id: SITE }],
    ['initiative', () => p.initiative.findFirst, { initiative_id: INIT }],
  ])('404 when the %s does not exist', async (_n, mock, extra) => {
    mock().mockResolvedValue(null);
    const res = await POST(req('POST', { sop_id: SOP, cadence: 'monthly', ...extra }));
    expect(res.status).toBe(404);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });

  it('requires the pm or admin role', async () => {
    (requireRole as Mock).mockImplementation(() => { throw new Error('forbidden'); });
    const res = await POST(req('POST', { sop_id: SOP, cadence: 'monthly' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });
});

describe('/api/recurring-work/[id]', () => {
  it('GET 404 when missing, row when found', async () => {
    p.recurringWork.findUnique.mockResolvedValueOnce(null);
    expect((await GET_ONE(req('GET'), ctx)).status).toBe(404);
    expect((await GET_ONE(req('GET'), ctx)).status).toBe(200);
  });

  it('PATCH deactivates with is_active false', async () => {
    const res = await PATCH(req('PATCH', { is_active: false }), ctx);
    expect(res.status).toBe(200);
    expect(p.recurringWork.update.mock.calls[0][0].data).toEqual({ is_active: false });
  });

  it('PATCH cannot change kind', async () => {
    expect((await PATCH(req('PATCH', { kind: 'engine' }), ctx)).status).toBe(400);
  });

  it('PATCH 400 when it would clear a field the kind requires', async () => {
    expect((await PATCH(req('PATCH', { cadence: null }), ctx)).status).toBe(400);
    expect(p.recurringWork.update).not.toHaveBeenCalled();
  });

  it('PATCH 404 for a missing row and for a missing initiative or owner', async () => {
    p.recurringWork.findUnique.mockResolvedValueOnce(null);
    expect((await PATCH(req('PATCH', { produces: 'x' }), ctx)).status).toBe(404);
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { initiative_id: INIT }), ctx)).status).toBe(404);
    p.user.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { owner_id: OWNER }), ctx)).status).toBe(404);
  });

  it('PATCH sets owner, produces and an initiative', async () => {
    const res = await PATCH(req('PATCH', { owner_id: OWNER, produces: 'a blog post', initiative_id: INIT }), ctx);
    expect(res.status).toBe(200);
    expect(p.recurringWork.update.mock.calls[0][0].data).toEqual({ owner_id: OWNER, produces: 'a blog post', initiative_id: INIT });
  });

  it('PATCH 400 when it sets a client or site on a charter row', async () => {
    p.recurringWork.findUnique.mockResolvedValue(stored({ charter_id: CHARTER }));
    expect((await PATCH(req('PATCH', { client_id: CLIENT }), ctx)).status).toBe(400);
    expect((await PATCH(req('PATCH', { site_id: SITE }), ctx)).status).toBe(400);
    expect(p.recurringWork.update).not.toHaveBeenCalled();
  });

  it('PATCH that moves a row onto a charter drops its own client and site', async () => {
    p.recurringWork.findUnique.mockResolvedValue(stored({ client_id: CLIENT, site_id: SITE }));
    const res = await PATCH(req('PATCH', { charter_id: CHARTER }), ctx);
    expect(res.status).toBe(200);
    expect(p.recurringWork.update.mock.calls[0][0].data).toEqual({ charter_id: CHARTER, client_id: null, site_id: null });
  });
});
