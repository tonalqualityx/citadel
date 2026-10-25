import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    charter: { findUnique: vi.fn() },
    engagementBrief: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    engagementPass: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { GET, PUT } from '../route';
import { POST as startPass } from '../[id]/passes/route';
import { PATCH as patchPass } from '../../engagement-passes/[id]/route';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = prisma as unknown as Record<string, Record<string, Mock>>;
const req = (method: string, body?: object, qs = '') =>
  new NextRequest(`http://localhost/api/x${qs}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const row = (over: Record<string, unknown> = {}) => ({
  id: U(100), client_id: U(1), project_id: null, charter_id: U(2), label: 'Herba', goal: '', sources: [], scope: {}, allowed_actions: ['note'],
  release_owner_role: 'pm', stall_rules: {}, owner_mode: 'dry', cadence: 'weekly', version: 1, last_pass_at: null, created_by_id: U(9),
  created_at: new Date('2026-10-23T00:00:00Z'), updated_at: new Date('2026-10-23T00:00:00Z'), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: U(9), role: 'pm' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('PUT /api/engagement-briefs', () => {
  it('creates a brief for a charter, deriving the client', async () => {
    db.charter.findUnique.mockResolvedValue({ client_id: U(1), is_deleted: false });
    db.engagementBrief.findUnique.mockResolvedValue(null);
    db.engagementBrief.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    const res = await PUT(req('PUT', { charter_id: U(2), label: 'Herba', owner_mode: 'dry', allowed_actions: ['note'] }));
    expect(res.status).toBe(201);
    expect(db.engagementBrief.create.mock.calls[0][0].data).toMatchObject({ client_id: U(1), charter_id: U(2), owner_mode: 'dry', created_by_id: U(9) });
  });

  it('an update bumps version', async () => {
    db.charter.findUnique.mockResolvedValue({ client_id: U(1), is_deleted: false });
    db.engagementBrief.findUnique.mockResolvedValue(row());
    db.engagementBrief.update.mockResolvedValue(row({ version: 2 }));
    const res = await PUT(req('PUT', { charter_id: U(2), label: 'Herba' }));
    expect(res.status).toBe(200);
    expect(db.engagementBrief.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    expect((await res.json()).version).toBe(2);
  });

  it('refuses a brief with neither project nor charter, and an unknown action', async () => {
    expect((await PUT(req('PUT', { label: 'x' }))).status).toBe(400);
    expect((await PUT(req('PUT', { charter_id: U(2), label: 'x', allowed_actions: ['send_email'] }))).status).toBe(400);
  });

  it('requires pm or admin', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await PUT(req('PUT', { charter_id: U(2), label: 'x' }))).status).toBe(403);
    expect((await GET(req('GET'))).status).toBe(403);
  });
});

describe('passes', () => {
  it('refuses a pass on an off brief and a live pass on a dry brief', async () => {
    db.engagementBrief.findUnique.mockResolvedValue(row({ owner_mode: 'off' }));
    expect((await startPass(req('POST', { mode: 'dry' }), ctx(U(100)))).status).toBe(409);
    db.engagementBrief.findUnique.mockResolvedValue(row({ owner_mode: 'dry' }));
    expect((await startPass(req('POST', { mode: 'live' }), ctx(U(100)))).status).toBe(409);
    expect(db.engagementPass.create).not.toHaveBeenCalled();
  });

  it('starts a dry pass on a dry brief and finishes it once', async () => {
    db.engagementBrief.findUnique.mockResolvedValue(row({ owner_mode: 'dry' }));
    const pass = { id: U(200), brief_id: U(100), mode: 'dry', started_at: new Date(), finished_at: null, model: null, cost_usd: null, tasks_read: 0, actions: [], mike_items: [], error: null };
    db.engagementPass.create.mockResolvedValue(pass);
    expect((await startPass(req('POST', { mode: 'dry' }), ctx(U(100)))).status).toBe(201);
    db.engagementPass.findUnique.mockResolvedValue(pass);
    db.engagementPass.update.mockResolvedValue({ ...pass, finished_at: new Date(), cost_usd: 0.42, tasks_read: 12 });
    const res = await patchPass(req('PATCH', { finished: true, cost_usd: 0.42, tasks_read: 12 }), ctx(U(200)));
    expect(res.status).toBe(200);
    expect(db.engagementBrief.update).toHaveBeenCalledTimes(1);
    expect((await res.json()).cost_usd).toBe(0.42);
  });
});
