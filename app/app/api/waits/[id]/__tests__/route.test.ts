import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { zonedTimeToUtc } from '@/lib/waits/business-days';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    wait: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.waits.get(where.id) ?? null) },
    waitEvent: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ is_active: true })) },
    function: { findUnique: vi.fn(async () => null) },
    projectTeamAssignment: { findMany: vi.fn(async () => []) },
    accord: { findUnique: vi.fn(async () => null) },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const UUID = '33333333-3333-4333-8333-333333333333';
const patch = (id: string, body: object) =>
  PATCH(new NextRequest(`http://localhost/api/waits/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), {
    params: Promise.resolve({ id }),
  });
const get = (id: string) => GET(new NextRequest(`http://localhost/api/waits/${id}`), { params: Promise.resolve({ id }) });

function seed() {
  const w = store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'the sitemap', started_at: new Date(Date.now() + 86_400_000) }));
  // use a real uuid id so the route accepts it
  store.waits.delete(w.id);
  const row = { ...w, id: UUID };
  store.waits.set(UUID, row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('GET /api/waits/:id', () => {
  it('returns the wait and its events', async () => {
    seed();
    const res = await get(UUID);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(UUID);
  });
  it('404s on a missing or malformed id', async () => {
    expect((await get(UUID)).status).toBe(404);
    expect((await get('nope')).status).toBe(404);
  });
});

describe('PATCH /api/waits/:id', () => {
  it('extends with a reason, logs it, and stops at the cap', async () => {
    seed();
    const r1 = await patch(UUID, { action: 'extend', business_days: 3, reason: 'Dan is out until Monday' });
    expect(r1.status).toBe(200);
    expect(store.events.at(-1)).toMatchObject({ kind: 'extended', source: 'user' });
    await patch(UUID, { action: 'extend', business_days: 3, reason: 'again' });
    const r3 = await patch(UUID, { action: 'extend', business_days: 3, reason: 'a third time' });
    expect(r3.status).toBe(409);
    expect((await r3.json()).code).toBe('cap');
    expect(store.waits.get(UUID)!.state).toBe('needs_human');
  });

  it('requires a reason to extend or re-date', async () => {
    seed();
    expect((await patch(UUID, { action: 'extend', business_days: 3 })).status).toBe(400);
    expect((await patch(UUID, { action: 'redate', due_at: '2026-11-02T22:00:00Z' })).status).toBe(400);
  });

  it('re-dates with a logged reason, from the ritual', async () => {
    seed();
    const due = zonedTimeToUtc(2026, 11, 2, 17).toISOString();
    const res = await patch(UUID, { action: 'redate', due_at: due, reason: 'Waiting on the logo files', source: 'ritual' });
    expect(res.status).toBe(200);
    expect((await res.json()).due_at).toBe(due);
    expect(store.events.at(-1)).toMatchObject({ kind: 'extended', source: 'ritual', reason: 'Waiting on the logo files' });
  });

  it('pauses into the future only, and resumes', async () => {
    seed();
    expect((await patch(UUID, { action: 'pause', until: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await patch(UUID, { action: 'resume' })).status).toBe(409);
    const until = new Date(Date.now() + 3_600_000).toISOString();
    expect((await patch(UUID, { action: 'pause', until })).status).toBe(200);
    expect(store.waits.get(UUID)!.state).toBe('paused');
    expect((await patch(UUID, { action: 'resume' })).status).toBe(200);
    expect(store.waits.get(UUID)!.state).toBe('waiting');
  });

  it('resolves, and a closed wait takes no other action', async () => {
    seed();
    const res = await patch(UUID, { action: 'resolve', resolution: 'approved' });
    expect(res.status).toBe(200);
    expect(store.waits.get(UUID)).toMatchObject({ state: 'done', resolution: 'approved', resolved_by_id: MIKE_USER_ID });
    expect((await patch(UUID, { action: 'extend', business_days: 1, reason: 'x' })).status).toBe(409);
    expect((await patch(UUID, { action: 'resolve', resolution: 'cancelled' })).status).toBe(409);
  });

  it('reassigns and sets a stand-in', async () => {
    seed();
    const other = '44444444-4444-4444-8444-444444444444';
    await patch(UUID, { action: 'reassign', owner_user_id: other });
    expect(store.waits.get(UUID)!.owner_user_id).toBe(other);
    await patch(UUID, { action: 'stand_in', stand_in_user_id: MIKE_USER_ID });
    expect(store.waits.get(UUID)!.stand_in_user_id).toBe(MIKE_USER_ID);
  });

  it('rejects unknown actions', async () => {
    seed();
    expect((await patch(UUID, { action: 'delete' })).status).toBe(400);
  });
});
