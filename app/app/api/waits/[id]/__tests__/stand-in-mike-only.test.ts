import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';

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

const UUID = '44444444-4444-4444-8444-444444444444';
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';
const patch = (body: object) =>
  PATCH(new NextRequest(`http://localhost/api/waits/${UUID}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), {
    params: Promise.resolve({ id: UUID }),
  });

function seed(template_key: string, mike_only?: boolean) {
  const w = store.add(buildWaitData({ template_key, subject: 'x', mike_only, started_at: new Date(Date.now() + 86_400_000) }, { allowDisabled: true }));
  store.waits.delete(w.id);
  store.waits.set(UUID, { ...w, id: UUID });
}

const ORIGINAL = process.env.OOO_STANDINS;
beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OOO_STANDINS;
  else process.env.OOO_STANDINS = ORIGINAL;
});

describe('PATCH stand_in and Mike-only waits', () => {
  it('flag ON: refuses to hand a Mike-only template to anyone (409), writes nothing', async () => {
    process.env.OOO_STANDINS = 'true';
    seed('sales.proposal_review');
    const res = await patch({ action: 'stand_in', stand_in_user_id: SABEEN });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Mike-only/);
    expect(store.waits.get(UUID)!.stand_in_user_id).toBeNull();
    expect(store.events).toHaveLength(0);
  });

  it('flag ON: refuses a wait the row marks Mike-only, even on a routable template', async () => {
    process.env.OOO_STANDINS = 'true';
    seed('change.needs_human', true);
    expect((await patch({ action: 'stand_in', stand_in_user_id: SABEEN })).status).toBe(409);
    expect(store.waits.get(UUID)!.stand_in_user_id).toBeNull();
  });

  it('flag ON: a routable wait can still be handed over, and a Mike-only stand-in can be cleared', async () => {
    process.env.OOO_STANDINS = 'true';
    seed('change.needs_human');
    expect((await patch({ action: 'stand_in', stand_in_user_id: SABEEN })).status).toBe(200);
    expect(store.waits.get(UUID)!.stand_in_user_id).toBe(SABEEN);

    store.waits.clear();
    seed('sales.proposal_review');
    store.waits.get(UUID)!.stand_in_user_id = SABEEN;
    expect((await patch({ action: 'stand_in', stand_in_user_id: null })).status).toBe(200);
    expect(store.waits.get(UUID)!.stand_in_user_id).toBeNull();
  });

  it('flag OFF: behaviour is unchanged, a Mike-only wait can still be handed over', async () => {
    delete process.env.OOO_STANDINS;
    seed('sales.proposal_review');
    expect((await patch({ action: 'stand_in', stand_in_user_id: SABEEN })).status).toBe(200);
    expect(store.waits.get(UUID)!.stand_in_user_id).toBe(SABEEN);
    expect(store.events.at(-1)).toMatchObject({ kind: 'stand_in', source: 'user' });
  });
});
