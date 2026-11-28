import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { recurringWork: { findUnique: vi.fn() } } }));
vi.mock('@/lib/recurring-work/pick', async (orig) => ({ ...(await orig<typeof import('@/lib/recurring-work/pick')>()), applyRecurringPick: vi.fn() }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { applyRecurringPick } from '@/lib/recurring-work/pick';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const RW = '77777777-7777-4777-8777-777777777777';
const USER = '55555555-5555-4555-8555-555555555555';
const ctx = { params: Promise.resolve({ id: RW }) };
const req = (body: unknown) =>
  new NextRequest(`http://localhost/api/recurring-work/${RW}/pick`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

const stored = {
  id: RW, kind: 'machine_job', title: 'Job', sort_order: 0, is_active: true, created_at: new Date(), updated_at: new Date(),
  mike_pick: 'cut', mike_pick_at: new Date('2026-11-28'), mike_pick_by: { id: USER, name: 'Mike' },
  pick_task: { id: 't1', title: 'T', status: 'not_started' },
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: USER, email: 'm@x.com', role: 'admin' });
  (requireRole as Mock).mockReturnValue(undefined);
  p.recurringWork.findUnique.mockResolvedValue(stored);
});

describe('POST /api/recurring-work/[id]/pick', () => {
  it('201 when a card is filed, with the formatted row', async () => {
    (applyRecurringPick as Mock).mockResolvedValue({ filed: true, already_open: false, task: { id: 't1', title: 'T', status: 'not_started' } });
    const res = await POST(req({ pick: 'cut' }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ filed: true, already_open: false, recurring_work: { id: RW, mike_pick: 'cut', pick_card_open: true } });
    expect(applyRecurringPick).toHaveBeenCalledWith({ id: RW, pick: 'cut', userId: USER });
  });

  it('200 for keep and for an already open card', async () => {
    (applyRecurringPick as Mock).mockResolvedValueOnce({ filed: false, already_open: false, task: null });
    expect((await POST(req({ pick: 'keep' }), ctx)).status).toBe(200);
    (applyRecurringPick as Mock).mockResolvedValueOnce({ filed: false, already_open: true, task: { id: 't1', title: 'T', status: 'not_started' } });
    const res = await POST(req({ pick: 'weekly' }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).already_open).toBe(true);
  });

  it('400 on a bad pick or an extra key', async () => {
    expect((await POST(req({ pick: 'delete' }), ctx)).status).toBe(400);
    expect((await POST(req({ pick: 'keep', cron_expr: '* * * * *' }), ctx)).status).toBe(400);
    expect(applyRecurringPick).not.toHaveBeenCalled();
  });

  it('403 for a role outside pm and admin', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new ApiError('Forbidden', 403);
    });
    expect((await POST(req({ pick: 'keep' }), ctx)).status).toBe(403);
    expect(applyRecurringPick).not.toHaveBeenCalled();
  });
});
