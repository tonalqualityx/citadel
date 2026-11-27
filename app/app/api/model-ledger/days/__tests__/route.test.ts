import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { modelLedgerDay: { upsert: vi.fn(), findMany: vi.fn() } } }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';

const db = prisma as unknown as { modelLedgerDay: { upsert: Mock; findMany: Mock } };
const req = (method: string, body?: object, url = 'http://localhost/api/model-ledger/days') =>
  new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const row = (o: Record<string, unknown> = {}) => ({
  day: '2026-11-27', model: 'opus', task_type: 'citadel-code', runs: 4, cards: 2, finished: 2, first_try: 1, escalations: 0, cost_usd: 12.5, unpriced_runs: 0, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u', email: 'b@x.com', role: 'pm' });
  (requireRole as Mock).mockReturnValue(undefined);
  db.modelLedgerDay.upsert.mockResolvedValue({});
});

describe('POST /api/model-ledger/days', () => {
  it('upserts each row by day, model and task type', async () => {
    const res = await POST(req('POST', { rows: [row(), row({ model: 'sonnet' })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 2 });
    const call = db.modelLedgerDay.upsert.mock.calls[0][0];
    expect(call.where.day_model_task_type).toEqual({ day: new Date('2026-11-27T00:00:00.000Z'), model: 'opus', task_type: 'citadel-code' });
    expect(call.update).toMatchObject({ runs: 4, cards: 2, finished: 2, first_try: 1, cost_usd: 12.5 });
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
  });

  it('refuses a duplicate key, a bad day and an empty list', async () => {
    expect((await POST(req('POST', { rows: [row(), row()] }))).status).toBe(400);
    expect((await POST(req('POST', { rows: [row({ day: '27-11-2026' })] }))).status).toBe(400);
    expect((await POST(req('POST', { rows: [] }))).status).toBe(400);
    expect(db.modelLedgerDay.upsert).not.toHaveBeenCalled();
  });

  it('refuses a role that is not pm or admin', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await POST(req('POST', { rows: [row()] }))).status).toBe(403);
  });
});

describe('GET /api/model-ledger/days', () => {
  it('sums the window per model and task type', async () => {
    db.modelLedgerDay.findMany.mockResolvedValue([
      { ...row(), day: new Date('2026-11-26T00:00:00Z'), cost_usd: '10.0000' },
      { ...row({ cards: 1, finished: 0, first_try: 0, escalations: 1 }), day: new Date('2026-11-27T00:00:00Z'), cost_usd: '2.5000' },
    ]);
    const res = await GET(req('GET', undefined, 'http://localhost/api/model-ledger/days?days=30'));
    const body = await res.json();
    expect(body.window_days).toBe(30);
    expect(body.latest_day).toBe('2026-11-27');
    expect(body.lines).toEqual([
      expect.objectContaining({ model: 'opus', task_type: 'citadel-code', runs: 8, cards: 3, finished: 2, first_try: 1, escalations: 1, cost_usd: 12.5, first_try_rate: 0.33, cost_per_finished_card: 6.25 }),
    ]);
    expect(db.modelLedgerDay.findMany.mock.calls[0][0].where.day.gte).toBeInstanceOf(Date);
  });

  it('refuses a window outside 1 to 90 days', async () => {
    expect((await GET(req('GET', undefined, 'http://localhost/api/model-ledger/days?days=0'))).status).toBe(400);
    expect((await GET(req('GET', undefined, 'http://localhost/api/model-ledger/days?days=abc'))).status).toBe(400);
  });
});
