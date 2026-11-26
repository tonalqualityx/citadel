import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findFirst: vi.fn() },
    recurringWork: { create: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const SOP = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u', email: 'm@x.com', role: 'admin' });
  p.charter.findFirst.mockResolvedValue({ id: 'c1', client_id: 'cl1', site_id: 'site1' });
  p.recurringWork.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rw', ...data, sop: { id: SOP, title: 'Report' }, created_at: new Date(), updated_at: new Date() }));
});

describe('POST /api/charters/[id]/scheduled-tasks', () => {
  it('creates a citadel_task recurring row that keeps no copy of the charter client or site', async () => {
    const res = await POST(
      new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ sop_id: SOP, cadence: 'monthly' }), headers: { 'Content-Type': 'application/json' } }),
      { params: Promise.resolve({ id: 'c1' }) }
    );
    expect(res.status).toBe(201);
    const data = p.recurringWork.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ charter_id: 'c1', kind: 'citadel_task', sop_id: SOP, cadence: 'monthly' });
    expect(data).not.toHaveProperty('client_id');
    expect(data).not.toHaveProperty('site_id');
    const body = await res.json();
    expect(body).toMatchObject({ charter_id: 'c1', sop_id: SOP, cadence: 'monthly', sop: { id: SOP, title: 'Report' } });
  });
});
