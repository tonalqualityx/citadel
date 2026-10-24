import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { prisma } from '@/lib/db/prisma';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { zonedTimeToUtc } from '@/lib/waits/business-days';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { updateMany: vi.fn(async () => ({ count: 1 })) },
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
const terms = { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-12-01' };
// The route reads the real clock; 2026-12-01 must stay 30+ days out, so fake it just before.

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com', via: 'session' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('approving a price review note', () => {
  it('records Mike\'s terms on the approval wait, resolves it, and opens the send step', async () => {
    seedApproval();
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(200);
    const w = store.waits.get(APPROVAL)!;
    expect(w).toMatchObject({ state: 'done', resolution: 'approved', resolved_by_id: MIKE_USER_ID });
    expect((w.action_payload as Record<string, unknown>).approved_terms).toMatchObject({ ...terms, approved_by: MIKE_USER_ID, approved_via: 'session' });
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


  it('refuses terms on any other wait', async () => {
    const w = store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'the sitemap', started_at: new Date(Date.now() + 86_400_000) }));
    store.waits.delete(w.id);
    store.waits.set(OTHER, { ...w, id: OTHER });
    const res = await patch(OTHER, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(400);
    expect(store.waits.get(OTHER)!.state).toBe('waiting');
  });
});

const sendStepCount = () => store.all().filter((x) => x.step === 3).length;

describe('the approval step ends only by Mike approving with terms or denying', () => {
  it.each(['completed', 'sent', 'booked', 'signed', 'cancelled'])(
    'refuses %s (the Oracle "Mark handled" button sends completed) with 409, from Mike or anyone',
    async (resolution) => {
      for (const who of [
        { userId: MIKE_USER_ID, role: 'admin', via: 'session' },
        { userId: NILS, role: 'pm', via: 'session' },
        { userId: MIKE_USER_ID, role: 'admin', via: 'api_key' },
      ]) {
        seedApproval();
        (requireAuth as Mock).mockResolvedValue({ ...who, email: 'x@example.com' });
        const res = await patch(APPROVAL, { action: 'resolve', resolution });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/cannot be marked handled/);
        expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
        expect(sendStepCount()).toBe(0);
      }
    }
  );

  it('refuses a bearer token or API key for the approval, even Mike\'s, and records nothing', async () => {
    seedApproval();
    (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com', via: 'api_key' });
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: terms });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/signed-in session/);
    const w = store.waits.get(APPROVAL)!;
    expect(w.state).toBe('waiting');
    expect((w.action_payload as Record<string, unknown>).approved_terms).toBeUndefined();
    expect(sendStepCount()).toBe(0);
  });

  it('refuses an auth object that does not say how it signed in', async () => {
    seedApproval();
    (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: terms })).status).toBe(403);
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'declined' })).status).toBe(403);
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
  });

  it('refuses a start date in the past or less than 30 days out', async () => {
    seedApproval();
    for (const effective_on of ['2026-10-01', '2026-10-24', '2026-11-22']) {
      const res = await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: { ...terms, effective_on } });
      expect(res.status).toBe(400);
    }
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'approved', approved_terms: { ...terms, effective_on: '2026-11-23' } })).status).toBe(200);
  });

  it('refuses a denial from anyone but Mike, or from a token or API key, and changes nothing', async () => {
    seedApproval();
    (requireAuth as Mock).mockResolvedValue({ userId: NILS, role: 'pm', email: 'n@example.com', via: 'session' });
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'declined' })).status).toBe(403);
    (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'm@example.com', via: 'api_key' });
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'declined' })).status).toBe(403);
    expect(store.waits.get(APPROVAL)!.state).toBe('waiting');
    expect(prisma.charter.updateMany).not.toHaveBeenCalled();
  });

  it('a denial from Mike\'s session ends the chain, stamps the review done, records the denial, sends nothing', async () => {
    seedApproval();
    const res = await patch(APPROVAL, { action: 'resolve', resolution: 'declined' });
    expect(res.status).toBe(200);
    const w = store.waits.get(APPROVAL)!;
    expect(w).toMatchObject({ state: 'done', resolution: 'declined', resolved_by_id: MIKE_USER_ID });
    expect((w.action_payload as Record<string, unknown>).price_review_denial).toMatchObject({ denied_by: MIKE_USER_ID, denied_via: 'session' });
    expect(sendStepCount()).toBe(0);
    expect(prisma.charter.updateMany).toHaveBeenCalledWith({ where: { id: 'ch1', price_review_done_at: null }, data: { price_review_done_at: expect.any(Date) } });
    const ev = store.events.find((e) => e.wait_id === APPROVAL && e.to_state === 'done');
    expect(ev?.reason).toMatch(/denied the price review/i);
    expect(ev?.reason).toMatch(/nothing was sent/i);
  });

  it('refuses terms on a denial', async () => {
    seedApproval();
    expect((await patch(APPROVAL, { action: 'resolve', resolution: 'declined', approved_terms: terms })).status).toBe(400);
  });
});
