import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/work/intake', async (orig) => ({
  ...(await orig<typeof import('@/lib/work/intake')>()),
  applyDecisions: vi.fn(async (_db: unknown, _items: unknown, o: { dry: boolean }) => ({ dry: o.dry, counts: {}, rows: [], closed: [], set: [], action_id: null })),
}));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { applyDecisions } from '@/lib/work/intake';

const A = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const req = (body: unknown) => new NextRequest('http://localhost:3000/api/work/apply-decisions', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const porter = { userId: 'bast', role: 'pm', email: 'b@x.test', via: 'api_key', apiKeyId: 'k', lane: 'porter' };
const item = { ask_id: A, disposition: 'no_action', reason: 'A thank-you.' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(porter as never);
});

describe('POST /api/work/apply-decisions', () => {
  it('lets an admin and the porter lane in, nobody else', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u', role: 'pm', email: 'u@x.test', via: 'session' } as never);
    expect((await POST(req({ dry: true, items: [item] }))).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue({ ...porter, lane: 'wright' } as never);
    expect((await POST(req({ dry: true, items: [item] }))).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a', role: 'admin', email: 'a@x.test', via: 'session' } as never);
    expect((await POST(req({ dry: true, items: [item] }))).status).toBe(200);
    expect(applyDecisions).toHaveBeenCalledTimes(1);
  });

  it('is strict: a missing dry, no items, more than 300, a bad value and an extra key are all 400', async () => {
    for (const body of [
      { items: [item] },
      { dry: true, items: [] },
      { dry: true, items: Array.from({ length: 301 }, () => item) },
      { dry: true, items: [{ ...item, disposition: 'ignore' }] },
      { dry: true, items: [{ ...item, extra: 1 }] },
      { dry: true, items: [item], nope: 1 },
    ]) {
      expect((await POST(req(body))).status).toBe(400);
    }
    expect(applyDecisions).not.toHaveBeenCalled();
  });

  it('passes dry through untouched, so dry and real run the same planner', async () => {
    await POST(req({ dry: true, items: [item] }));
    await POST(req({ dry: false, items: [item] }));
    expect(vi.mocked(applyDecisions).mock.calls.map((c) => (c[2] as { dry: boolean }).dry)).toEqual([true, false]);
    expect(vi.mocked(applyDecisions).mock.calls[0][1]).toEqual(vi.mocked(applyDecisions).mock.calls[1][1]);
  });
});
