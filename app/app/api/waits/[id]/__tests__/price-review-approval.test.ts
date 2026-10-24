import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';
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

const APPROVAL = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const NILS = '5b98dcb5-93a1-4147-82b7-f462c9ea09ae';
const terms = { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-11-01' };

const patch = (id: string, body: object) =>
  PATCH(new NextRequest(`http://localhost/api/waits/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), {
    params: Promise.resolve({ id }),
  });

function seedApproval(id = APPROVAL) {
  const w = store.add(
    buildWaitData({
      template_key: 'charter.price_review',
      step: 2,
      subject: 'Acme care plan',
      started_at: zonedTimeToUtc(2026, 11, 4, 10),
      client_id: 'c1',
      charter_id: 'ch1',
    })
  );
  store.waits.delete(w.id);
  store.waits.set(id, { ...w, id });
  return store.waits.get(id)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('approving a price review note', () => {
  it('records Mike\'s terms on the approval wait, resolves it, and opens the send step', async () => {
    seedApproval();
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(200);
    const w = store.waits.get(APPROVAL)!;
    expect(w).toMatchObject({ state: 'done', resolution: 'approved', resolved_by_id: MIKE_USER_ID });
    expect((w.action_payload as Record<string, unknown>).approved_terms).toMatchObject({ ...terms, approved_by: MIKE_USER_ID });
    const next = store.all().filter((x) => x.step === 3);
    expect(next).toHaveLength(1);
    expect(next[0].idempotency_key).toBe(`${APPROVAL}:next`);
  });

  it('refuses an approval from anyone but Mike, and records nothing', async () => {
    seedApproval();
    (requireAuth as Mock).mockResolvedValue({ userId: NILS, role: 'pm', email: 'nils@becomeindelible.com' });
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(403);
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
    expect((store.waits.get(APPROVAL)!.action_payload as Record<string, unknown>).approved_terms).toBeUndefined();
  });

  it('refuses an approval with no terms', async () => {
    seedApproval();
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved' });
    expect(res.status).toBe(400);
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
  });

  it('refuses bad terms', async () => {
    seedApproval();
    for (const bad of [
      { ...terms, new_amount_cents: 0 },
      { ...terms, new_amount_cents: 12.5 },
      { ...terms, period: 'weekly' },
      { ...terms, effective_on: '2026-02-30' },
      { ...terms, extra: 'x' },
      { period: 'monthly', effective_on: '2026-11-01' },
    ]) {
      expect((await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: bad })).status).toBe(400);
    }
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
  });

  it('allows declining or cancelling without terms', async () => {
    seedApproval();
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'cancelled' });
    expect(res.status).toBe(200);
    expect(store.all().filter((x) => x.step === 3)).toHaveLength(0);
  });

  it('refuses terms on any other wait', async () => {
    const w = store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'the sitemap', started_at: new Date(Date.now() + 86_400_000) }));
    store.waits.delete(w.id);
    store.waits.set(OTHER, { ...w, id: OTHER });
    const res = await patch(OTHER, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(400);
    expect(store.waits.get(OTHER)!.state).toBe('waiting');
  });
});
