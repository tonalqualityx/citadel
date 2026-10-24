import { describe, it, expect, vi } from 'vitest';
import { runSweep, resolveWait, type WaitRow } from '@/lib/waits/sweeper';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID, type OwnerLookups } from '@/lib/waits/owner';
import { zonedTimeToUtc } from '@/lib/waits/business-days';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { firstStepDueAt, waitKeyFor } from '../open';

const lookups: OwnerLookups = {
  isActiveUser: async () => true,
  functionName: async () => null,
  projectRoleHolder: async () => null,
  charterRoleHolder: async () => null,
  clientRoleHolder: async () => null,
  accordOwner: async () => null,
};
const et = (y: number, m: number, d: number, h = 0) => zonedTimeToUtc(y, m, d, h);

// Review date Mon 2026-11-16; the first step is due 14 days before, 09:00 Eastern Mon 2026-11-02.
const REVIEW_ON = new Date('2026-11-16T00:00:00.000Z');
const CHARTER = '11111111-1111-4111-8111-111111111111';

function openFirst(store: MemStore) {
  return store.add(
    buildWaitData({
      template_key: 'charter.price_review',
      subject: 'Acme care plan',
      title: 'Draft the price review note for Acme care plan',
      detail: 'DRAFT INPUTS AND THE LAW',
      due_at: firstStepDueAt(REVIEW_ON),
      started_at: firstStepDueAt(REVIEW_ON),
      client_id: 'c1',
      charter_id: CHARTER,
      idempotency_key: waitKeyFor(CHARTER, REVIEW_ON),
    })
  );
}

function harness(over: { wait?: boolean; price?: boolean } = {}) {
  const store = new MemStore();
  const sent = vi.fn(async (_w: WaitRow, _n: Date) => undefined);
  const applied = vi.fn(async (_w: WaitRow, _e: string | null) => undefined);
  const switches = { wait: over.wait ?? true, price: over.price ?? true };
  const run = (now: Date, dryRun = false) =>
    runSweep(
      {
        store,
        owner: lookups,
        now: () => now,
        switchIsOn: async (k: string) => (k === 'WAIT_SENDERS' ? switches.wait : k === 'PRICE_REVIEW_SEND' ? switches.price : false),
        applyProceed: applied,
        sendHandlers: { 'charter.price_review': sent },
      },
      { dryRun }
    );
  return { store, sent, applied, switches, run };
}

describe('the clock', () => {
  it('the first step is due 14 calendar days before the review date at 09:00 Eastern', () => {
    expect(firstStepDueAt(REVIEW_ON).getTime()).toBe(et(2026, 11, 2, 9).getTime());
    // Across the 2026-11-01 DST change the clock still reads 09:00 Eastern.
    expect(firstStepDueAt(new Date('2026-11-10T00:00:00.000Z')).getTime()).toBe(et(2026, 10, 27, 9).getTime());
  });

  it('the key is the charter and the date', () => {
    expect(waitKeyFor(CHARTER, REVIEW_ON)).toBe(`price-review:${CHARTER}:2026-11-16`);
  });
});

describe('charter.price_review through the sweeper', () => {
  it('a dry run reports the task step due and writes nothing', async () => {
    const h = harness();
    const w = openFirst(h.store);
    const before = JSON.stringify(h.store.get(w.id));
    const r = await h.run(et(2026, 11, 3, 10), true);
    expect(r.fired).toEqual([expect.objectContaining({ id: w.id, step: 1, action: 'task' })]);
    expect(JSON.stringify(h.store.get(w.id))).toBe(before);
    expect(h.store.tasks).toHaveLength(0);
  });

  it('step 1 makes a task for Bast with the title and the law, and waits for it to be done', async () => {
    const h = harness();
    const w = openFirst(h.store);
    await h.run(et(2026, 11, 3, 10));
    expect(h.store.tasks).toHaveLength(1);
    expect(h.store.tasks[0]).toMatchObject({
      title: 'Draft the price review note for Acme care plan',
      assignee_id: BAST_USER_ID,
      charter_id: CHARTER,
    });
    expect(h.store.tasks[0].description).toContain('DRAFT INPUTS AND THE LAW');
    // Step 2 is NOT open yet: Mike has nothing to approve until the draft task is done.
    expect(h.store.all().filter((x) => x.step === 2)).toHaveLength(0);
    expect(h.store.get(w.id)).toMatchObject({ state: 'done', resolution: 'task_created' });
  });

  it('opens the approval for Mike when the draft task is done, once', async () => {
    const h = harness();
    openFirst(h.store);
    await h.run(et(2026, 11, 3, 10));
    const handoff = h.store.all().find((x) => x.template_key === 'handoff.generic')!;
    h.store.subject[handoff.id] = 'task_done';
    await h.run(et(2026, 11, 4, 10));
    await h.run(et(2026, 11, 4, 11));
    const approvals = h.store.all().filter((x) => x.step === 2);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ kind: 'approval', title: 'Approve the price review note for Acme care plan' });
    expect((approvals[0].action_payload as Record<string, unknown>).owner_role).toBe('mike');
  });

  it('a failure opening the approval leaves the draft handoff open, so the next pass retries', async () => {
    const h = harness();
    openFirst(h.store);
    await h.run(et(2026, 11, 3, 10));
    const handoff = h.store.all().find((x) => x.template_key === 'handoff.generic')!;
    h.store.subject[handoff.id] = 'task_done';
    const spy = vi.spyOn(h.store, 'getWait').mockRejectedValueOnce(new Error('db hiccup'));
    await expect(h.run(et(2026, 11, 4, 10))).rejects.toThrow('db hiccup');
    spy.mockRestore();
    expect(h.store.get(handoff.id).state).toBe('waiting');
    expect(h.store.all().filter((x) => x.step === 2)).toHaveLength(0);
    await h.run(et(2026, 11, 4, 11));
    expect(h.store.get(handoff.id).state).toBe('done');
    expect(h.store.all().filter((x) => x.step === 2)).toHaveLength(1);
  });

  it('a hand-opened wait cannot start the chain by naming a wait', async () => {
    const h = harness();
    const first = openFirst(h.store);
    await h.run(et(2026, 11, 3, 10));
    const forged = h.store.add(
      buildWaitData({ template_key: 'handoff.generic', subject: 'forged', title: 'forged', task_id: 'other-task', action_payload: { from_wait_id: first.id } })
    );
    h.store.subject[forged.id] = 'task_done';
    await h.run(et(2026, 11, 4, 10));
    expect(h.store.all().filter((x) => x.step === 2)).toHaveLength(0);
  });

  async function toSendStep(h: ReturnType<typeof harness>) {
    openFirst(h.store);
    await h.run(et(2026, 11, 3, 10));
    const handoff = h.store.all().find((x) => x.template_key === 'handoff.generic')!;
    h.store.subject[handoff.id] = 'task_done';
    await h.run(et(2026, 11, 4, 10));
    const approval = h.store.all().find((x) => x.step === 2)!;
    // Mike's approval, as the PATCH route records it from his session.
    h.store.waits.set(approval.id, {
      ...approval,
      action_payload: {
        ...(approval.action_payload as object),
        approved_terms: { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-12-15', approved_by: MIKE_USER_ID, approved_via: 'session', approved_at: '2026-11-05T15:00:00.000Z' },
      },
    } as WaitRow);
    await resolveWait(h.store, h.store.get(approval.id), 'approved', { now: et(2026, 11, 5, 10), source: 'user', actor_user_id: MIKE_USER_ID });
    return h.store.all().find((x) => x.step === 3)!;
  }

  it('holds the send as blocked_by_switch with PRICE_REVIEW_SEND off, and calls no sender', async () => {
    const h = harness({ price: false });
    const send = await toSendStep(h);
    const r = await h.run(et(2026, 11, 5, 11));
    expect(r.blocked_by_switch).toEqual([send.id]);
    expect(h.store.get(send.id)).toMatchObject({ state: 'blocked_by_switch', switch_key: 'PRICE_REVIEW_SEND' });
    expect(h.sent).not.toHaveBeenCalled();
    expect(h.applied).not.toHaveBeenCalled();
    expect(h.store.all().filter((x) => x.step === 4)).toHaveLength(0);
  });

  it('holds the send with WAIT_SENDERS off, and calls no sender', async () => {
    const h = harness({ wait: false });
    const send = await toSendStep(h);
    await h.run(et(2026, 11, 5, 11));
    expect(h.store.get(send.id)).toMatchObject({ state: 'blocked_by_switch', switch_key: 'WAIT_SENDERS' });
    expect(h.sent).not.toHaveBeenCalled();
  });

  it('a dry run with the switches on still calls no sender', async () => {
    const h = harness();
    const send = await toSendStep(h);
    const r = await h.run(et(2026, 11, 5, 11), true);
    expect(r.fired.map((f) => f.id)).toContain(send.id);
    expect(h.sent).not.toHaveBeenCalled();
    expect(h.store.get(send.id).state).toBe('waiting');
  });

  it('a switch turned on later releases the held send, which then sends once and stamps done', async () => {
    const h = harness({ price: false });
    const send = await toSendStep(h);
    await h.run(et(2026, 11, 5, 11));
    h.switches.price = true;
    await h.run(et(2026, 11, 5, 12)); // released
    await h.run(et(2026, 11, 5, 13)); // fires
    expect(h.sent).toHaveBeenCalledTimes(1);
    expect(h.store.get(send.id)).toMatchObject({ state: 'done', resolution: 'sent' });
    await h.run(et(2026, 11, 5, 14)); // step 4 proceeds
    expect(h.applied).toHaveBeenCalledTimes(1);
    expect(h.applied.mock.calls[0][1]).toBe('price_review_done');
    await h.run(et(2026, 11, 5, 15));
    expect(h.sent).toHaveBeenCalledTimes(1);
    expect(h.applied).toHaveBeenCalledTimes(1);
  });

  it('holds a send outside the send window even with both switches on', async () => {
    const h = harness();
    const send = await toSendStep(h);
    await h.run(et(2026, 11, 5, 21));
    expect(h.sent).not.toHaveBeenCalled();
    expect(h.store.get(send.id).state).toBe('waiting');
  });

  it('a sender that throws three times hands the wait to Mike and sends nothing', async () => {
    const h = harness();
    h.sent.mockRejectedValue(new Error('No approved amount'));
    const send = await toSendStep(h);
    for (let i = 0; i < 3; i++) await h.run(et(2026, 11, 5, 10 + i));
    expect(h.store.get(send.id)).toMatchObject({ state: 'needs_human', owner_user_id: MIKE_USER_ID });
  });
});
