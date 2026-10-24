import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/kpis/confirm', async (orig) => ({ ...(await orig<typeof import('@/lib/kpis/confirm')>()), confirmKpiProposal: vi.fn() }));

import { POST } from '../confirm/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { confirmKpiProposal, KpiConfirmError } from '@/lib/kpis/confirm';

const ID = '44444444-4444-4444-8444-444444444444';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = () => new NextRequest(`http://localhost/api/accords/${ID}/kpis/confirm`, { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm', email: 'x@y.z' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('POST /api/accords/[id]/kpis/confirm', () => {
  it('refuses without a session and for non-staff', async () => {
    (requireAuth as Mock).mockRejectedValueOnce(new AuthError('Authentication required', 401));
    expect((await POST(req(), ctx)).status).toBe(401);
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await POST(req(), ctx)).status).toBe(403);
    expect(confirmKpiProposal).not.toHaveBeenCalled();
  });
  it('201 when rows were created, 200 on an idempotent repeat', async () => {
    (confirmKpiProposal as Mock).mockResolvedValueOnce({ created: 2, confirmed: 0, unchanged: 0, rows: ['a', 'b'] });
    expect((await POST(req(), ctx)).status).toBe(201);
    (confirmKpiProposal as Mock).mockResolvedValueOnce({ created: 0, confirmed: 0, unchanged: 2, rows: [] });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, unchanged: 2 });
  });
  it('404 for an unknown accord, 409 when there is nothing to confirm', async () => {
    (confirmKpiProposal as Mock).mockRejectedValueOnce(new KpiConfirmError('Accord not found', 'accord_not_found'));
    expect((await POST(req(), ctx)).status).toBe(404);
    (confirmKpiProposal as Mock).mockRejectedValueOnce(new KpiConfirmError('The accord has no KPI proposal', 'no_proposal'));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_proposal');
    expect((await POST(req(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
  });
});
