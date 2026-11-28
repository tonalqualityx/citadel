import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    recurringWork: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma };
});

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/recurring-work/machine-sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const job = (key: string, o: Record<string, unknown> = {}) => ({ job_key: key, title: `Job ${key}`, owner_id: OWNER, cron_expr: '*/10 * * * *', ...o });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: OWNER, email: 'b@x.com', role: 'pm' });
  (requireRole as Mock).mockReturnValue(undefined);
  p.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id === OWNER).map((id) => ({ id })));
  p.recurringWork.findMany.mockResolvedValue([]);
  p.recurringWork.create.mockResolvedValue({});
  p.recurringWork.update.mockResolvedValue({});
  p.recurringWork.updateMany.mockResolvedValue({ count: 0 });
});

describe('POST /api/recurring-work/machine-sync', () => {
  it('requires the pm or admin role', async () => {
    await POST(req({ jobs: [job('a')] }));
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
  });

  it('creates new rows as active machine jobs', async () => {
    const res = await POST(req({ jobs: [job('a', { is_plumbing: true, group_label: 'Background', last_run_at: '2026-11-26T07:00:00-05:00', last_run_ok: true })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1, updated: 0, deactivated: 0, skipped: [], total: 1 });
    const data = p.recurringWork.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'machine_job', job_key: 'a', title: 'Job a', is_active: true, is_plumbing: true, group_label: 'Background', owner_id: OWNER });
    expect(data.last_run_at).toBeInstanceOf(Date);
  });

  it('updates existing rows without touching initiative, client, site or sort order', async () => {
    p.recurringWork.findMany.mockResolvedValueOnce([{ id: 'row-1', job_key: 'a', kind: 'machine_job' }]);
    const res = await POST(req({ jobs: [job('a', { last_run_ok: false, last_run_note: 'failing: no log' })] }));
    expect(await res.json()).toMatchObject({ created: 0, updated: 1 });
    const call = p.recurringWork.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'row-1' });
    expect(call.data).toMatchObject({ is_active: true, last_run_ok: false, last_run_note: 'failing: no log' });
    for (const k of ['initiative_id', 'client_id', 'site_id', 'sort_order', 'kind', 'job_key']) expect(call.data).not.toHaveProperty(k);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });

  it('a rerun with the same body creates 0', async () => {
    p.recurringWork.findMany.mockResolvedValue([
      { id: 'r1', job_key: 'a', kind: 'machine_job' },
      { id: 'r2', job_key: 'b', kind: 'machine_job' },
    ]);
    const body = { jobs: [job('a'), job('b')] };
    expect(await (await POST(req(body))).json()).toEqual({ created: 0, updated: 2, deactivated: 0, skipped: [], total: 2 });
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });

  it('marks active machine jobs missing from the list inactive, never deletes', async () => {
    p.recurringWork.updateMany.mockResolvedValue({ count: 3 });
    const body = await (await POST(req({ jobs: [job('a')] }))).json();
    expect(body.deactivated).toBe(3);
    expect(p.recurringWork.updateMany).toHaveBeenCalledWith({
      where: { kind: 'machine_job', is_active: true, job_key: { notIn: ['a'] } },
      data: { is_active: false },
    });
  });

  it('rejects an empty list', async () => {
    const res = await POST(req({ jobs: [] }));
    expect(res.status).toBe(400);
    expect(p.recurringWork.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a duplicate job_key', async () => {
    const res = await POST(req({ jobs: [job('a'), job('a')] }));
    expect(res.status).toBe(400);
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown owner and names it', async () => {
    const res = await POST(req({ jobs: [job('a', { owner_id: OTHER })] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(OTHER);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });

  it('skips a job_key held by a non-machine row and lists it', async () => {
    p.recurringWork.findMany.mockResolvedValueOnce([{ id: 'e1', job_key: 'a', kind: 'engine' }]);
    const body = await (await POST(req({ jobs: [job('a')] }))).json();
    expect(body).toMatchObject({ created: 0, updated: 0, skipped: ['a'] });
    expect(p.recurringWork.update).not.toHaveBeenCalled();
  });

  it('rejects unknown fields', async () => {
    expect((await POST(req({ jobs: [job('a', { initiative_id: OWNER })] }))).status).toBe(400);
  });

  const NEW_KEYS = [
    'usage_week_tokens', 'usage_month_tokens', 'usage_week_usd', 'usage_month_usd', 'usage_week_share', 'usage_state', 'usage_note',
    'usage_updated_at', 'destinations', 'destination_note', 'last_used_at', 'last_used_signal', 'priority',
  ];

  it('writes the usage, destination, last-used and priority fields on create', async () => {
    const res = await POST(req({ jobs: [job('a', {
      usage_week_tokens: 4_000_000_000, usage_month_tokens: 9_000_000_000, usage_week_usd: 10, usage_month_usd: 40, usage_week_share: 77.35,
      usage_state: 'measured', usage_note: 'ok', usage_updated_at: '2026-11-28T09:00:00Z', destinations: ['slack', 'slack', 'file_only'],
      destination_note: 'n', last_used_at: '2026-11-26T09:00:00Z', last_used_signal: 'opened', priority: 'low',
    })] }));
    expect(res.status).toBe(200);
    const data = p.recurringWork.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      usage_week_tokens: BigInt(4_000_000_000), usage_month_tokens: BigInt(9_000_000_000), usage_week_usd: 10, usage_week_share: 77.35,
      usage_state: 'measured', destinations: ['slack', 'file_only'], priority: 'low', last_used_signal: 'opened',
    });
    expect(data.usage_updated_at).toBeInstanceOf(Date);
  });

  it('writes the new fields on update, and destinations null clears to []', async () => {
    p.recurringWork.findMany.mockResolvedValueOnce([{ id: 'row-1', job_key: 'a', kind: 'machine_job' }]);
    await POST(req({ jobs: [job('a', { usage_week_tokens: 7, destinations: null, priority: 'normal' })] }));
    expect(p.recurringWork.update.mock.calls[0][0].data).toMatchObject({ usage_week_tokens: BigInt(7), destinations: [], priority: 'normal' });
  });

  it('an item without the new keys sends none of them, so stored values stay as they were', async () => {
    p.recurringWork.findMany.mockResolvedValueOnce([{ id: 'row-1', job_key: 'a', kind: 'machine_job' }]);
    await POST(req({ jobs: [job('a'), job('b')] }));
    for (const k of NEW_KEYS) {
      expect(p.recurringWork.update.mock.calls[0][0].data).not.toHaveProperty(k);
      expect(p.recurringWork.create.mock.calls[0][0].data).not.toHaveProperty(k);
    }
  });

  it('rejects an invalid destination or priority', async () => {
    expect((await POST(req({ jobs: [job('a', { destinations: ['fax'] })] }))).status).toBe(400);
    expect((await POST(req({ jobs: [job('a', { priority: 'high' })] }))).status).toBe(400);
    expect((await POST(req({ jobs: [job('a', { priority: null })] }))).status).toBe(400);
    expect(p.recurringWork.create).not.toHaveBeenCalled();
  });
});
