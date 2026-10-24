import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queuePriceReviewSend, loadApprovalFor } from '../send';
import { PriceReviewRenderError } from '../template';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import type { WaitRow } from '@/lib/waits/sweeper';

const CHARTER = '11111111-1111-4111-8111-111111111111';
const APPROVAL_ID = '22222222-2222-4222-8222-222222222222';
const SEND_ID = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';

const terms = { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-11-01' };

function approvalWait(over: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_ID,
    template_key: 'charter.price_review',
    step: 2,
    state: 'done',
    resolution: 'approved',
    resolved_by_id: MIKE_USER_ID,
    charter_id: CHARTER,
    action_payload: { approved_terms: { ...terms, approved_by: MIKE_USER_ID, approved_at: '2026-10-30T12:00:00.000Z' } },
    ...over,
  };
}

const sendWait = { id: SEND_ID, charter_id: CHARTER, idempotency_key: `${APPROVAL_ID}:next` } as unknown as WaitRow;

function fakeDb(opts: { approval?: Record<string, unknown> | null; contacts?: unknown[]; existingKey?: boolean } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    wait: { findUnique: vi.fn(async () => (opts.approval === null ? null : (opts.approval ?? approvalWait()))) },
    charter: {
      findUnique: vi.fn(async () => ({ id: CHARTER, client_id: 'c1', client_label: 'Care plan', is_deleted: false, status: 'active', client: { name: 'Acme' } })),
    },
    clientContact: { findMany: vi.fn(async () => opts.contacts ?? [{ id: CONTACT, name: 'Dana Reed', email: 'dana@acme.example' }]) },
    emailOutbox: {
      findUnique: vi.fn(async () => (opts.existingKey ? { id: 'existing' } : null)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `row${created.length}` };
      }),
    },
  };
  return { db: db as never, created, raw: db };
}

const on = async () => true;
const off = async () => false;

beforeEach(() => {
  process.env.PRICE_REVIEW_SEND = 'true';
});
afterEach(() => {
  delete process.env.PRICE_REVIEW_SEND;
});

describe('price review send', () => {
  it('queues one outbox row per portal owner when both switches are on', async () => {
    const { db, created } = fakeDb({
      contacts: [
        { id: CONTACT, name: 'Dana Reed', email: 'dana@acme.example' },
        { id: '55555555-5555-4555-8555-555555555555', name: null, email: 'lee@acme.example' },
      ],
    });
    const r = await queuePriceReviewSend(db, sendWait, { switchIsOn: on });
    expect(r.queued).toHaveLength(2);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      to: 'dana@acme.example',
      kind: 'price_review',
      allow_external: true,
      from_account: 'bast@becomeindelible.com',
      dedupe_key: `price-review:${SEND_ID}:${CONTACT}`,
    });
    expect(String(created[0].text)).toContain('$150 per month');
    expect(String(created[0].text)).toContain('Hello Dana,');
    expect(String(created[1].text)).toContain('Hello,');
  });

  it('queues nothing with PRICE_REVIEW_SEND off', async () => {
    for (const v of [undefined, 'false', '1', 'TRUE', 'yes']) {
      if (v === undefined) delete process.env.PRICE_REVIEW_SEND;
      else process.env.PRICE_REVIEW_SEND = v;
      const { db, raw } = fakeDb();
      await expect(queuePriceReviewSend(db, sendWait, { switchIsOn: on })).rejects.toThrow(/switch is off/);
      expect(raw.emailOutbox.create).not.toHaveBeenCalled();
    }
  });

  it('queues nothing with WAIT_SENDERS off', async () => {
    const { db, raw } = fakeDb();
    await expect(queuePriceReviewSend(db, sendWait, { switchIsOn: off })).rejects.toThrow(/switch is off/);
    expect(raw.emailOutbox.create).not.toHaveBeenCalled();
  });

  it('refuses to render without an approval amount', async () => {
    const noTerms = fakeDb({ approval: approvalWait({ action_payload: {} }) });
    await expect(queuePriceReviewSend(noTerms.db, sendWait, { switchIsOn: on })).rejects.toBeInstanceOf(PriceReviewRenderError);
    expect(noTerms.created).toHaveLength(0);
    const none = fakeDb({ approval: null });
    await expect(queuePriceReviewSend(none.db, sendWait, { switchIsOn: on })).rejects.toBeInstanceOf(PriceReviewRenderError);
    expect(none.created).toHaveLength(0);
  });

  it('ignores an approval that is not Mike\'s, not approved, the wrong step, or another charter', async () => {
    const cases = [
      { resolved_by_id: '99999999-9999-4999-8999-999999999999' },
      { resolution: 'cancelled' },
      { state: 'waiting' },
      { step: 3 },
      { template_key: 'handoff.generic' },
      { charter_id: '66666666-6666-4666-8666-666666666666' },
      { action_payload: { approved_terms: { ...terms, approved_by: '99999999-9999-4999-8999-999999999999' } } },
    ];
    for (const c of cases) {
      const { db, created } = fakeDb({ approval: approvalWait(c) });
      expect(await loadApprovalFor(db as never, sendWait)).toBeNull();
      await expect(queuePriceReviewSend(db, sendWait, { switchIsOn: on })).rejects.toBeInstanceOf(PriceReviewRenderError);
      expect(created).toHaveLength(0);
    }
  });

  it('a send wait that did not come from an approval has no approval', async () => {
    const { db } = fakeDb();
    expect(await loadApprovalFor(db as never, { ...sendWait, idempotency_key: 'price-review:x:2026-11-01' } as WaitRow)).toBeNull();
  });

  it('queues nothing when the client has no portal owner address', async () => {
    const { db, created } = fakeDb({ contacts: [] });
    await expect(queuePriceReviewSend(db, sendWait, { switchIsOn: on })).rejects.toThrow(/no portal owner/);
    expect(created).toHaveLength(0);
  });

  it('a repeat adds no second row', async () => {
    const { db, created } = fakeDb({ existingKey: true });
    const r = await queuePriceReviewSend(db, sendWait, { switchIsOn: on });
    expect(r.queued).toEqual(['existing']);
    expect(created).toHaveLength(0);
  });
});
