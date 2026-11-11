import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {};
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true }));
  return { prisma };
});
vi.mock('@/lib/work/backfill', async (orig) => ({
  ...(await orig<typeof import('@/lib/work/backfill')>()),
  planBackfill: vi.fn(async () => ({ counts: { open_total: 5, would_close: 1 }, keys: [], links: [], unmatched: [] })),
  applyBackfill: vi.fn(async () => ({ keys_set: 0, linked: 1, closed: 1, action_id: 'x' })),
  backfillLists: vi.fn(() => ({ would_close: [], left_open_after_done: [], held_security: [], unmatched: [] })),
}));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { planBackfill, applyBackfill } from '@/lib/work/backfill';

const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const req = (body: unknown) => new NextRequest('http://localhost:3000/api/work/backfill-links', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const porter = { userId: 'bast', role: 'pm', email: 'b@x.test', via: 'api_key', apiKeyId: 'k', lane: 'porter' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(porter as never);
});

describe('POST /api/work/backfill-links', () => {
  it('lets an admin and the porter lane in, nobody else', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u', role: 'pm', email: 'u@x.test', via: 'session' } as never);
    expect((await POST(req({ dry: true }))).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue({ ...porter, lane: 'wright' } as never);
    expect((await POST(req({ dry: true }))).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a', role: 'admin', email: 'a@x.test', via: 'session' } as never);
    expect((await POST(req({ dry: true }))).status).toBe(200);
  });

  it('is strict: a missing dry, an unknown key, an unknown basis and more than 500 pairs are all 400', async () => {
    expect((await POST(req({ pairs: [] }))).status).toBe(400);
    expect((await POST(req({ dry: true, nope: 1 }))).status).toBe(400);
    expect((await POST(req({ dry: true, pairs: [{ message_id: 'm', task_id: T, basis: 'guess' }] }))).status).toBe(400);
    const pair = { message_id: 'm', task_id: T, basis: 'registry' };
    expect((await POST(req({ dry: true, pairs: Array.from({ length: 501 }, () => pair) }))).status).toBe(400);
    expect(planBackfill).not.toHaveBeenCalled();
  });

  it('dry:true plans only: no transaction, no apply', async () => {
    const res = await POST(req({ dry: true, pairs: [{ message_id: 'm', task_id: T, basis: 'source_ref' }] }));
    const body = await res.json();
    expect(body).toMatchObject({ dry: true, counts: { open_total: 5, would_close: 1 } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(applyBackfill).not.toHaveBeenCalled();
  });

  it('dry:false plans and applies in one transaction, and the plan is the same planner the dry run uses', async () => {
    const body = { dry: false, pairs: [{ message_id: 'm', task_id: T, basis: 'source_ref' }] };
    const res = await POST(req(body));
    const json = await res.json();
    expect(json).toMatchObject({ dry: false, applied: { linked: 1, closed: 1 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(planBackfill).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({ dry: false }), expect.any(Date));
    expect(applyBackfill).toHaveBeenCalledTimes(1);
  });
});
