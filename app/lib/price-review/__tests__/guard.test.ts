import { describe, it, expect } from 'vitest';
import { resolveWait, type WaitRow } from '@/lib/waits/sweeper';
import { applyWaitEvent } from '@/lib/waits/events';
import { resolveByPerson } from '@/lib/waits/actions';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { zonedTimeToUtc } from '@/lib/waits/business-days';
import { assertPriceReviewResolution, PriceReviewResolutionRefused } from '../guard';

const NOW = zonedTimeToUtc(2026, 11, 4, 10);
const terms = { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-12-15' };

function approval(store: MemStore, payload: Record<string, unknown> = {}) {
  const w = store.add(
    buildWaitData({
      template_key: 'charter.price_review',
      step: 2,
      subject: 'Acme care plan',
      started_at: NOW,
      client_id: 'c1',
      charter_id: 'ch1',
    })
  );
  // buildWaitData drops object payloads from callers, as it should. Write the record the way the route does.
  store.waits.set(w.id, { ...w, action_payload: { ...(w.action_payload as object), ...payload } as WaitRow['action_payload'] });
  return store.waits.get(w.id)!;
}
const stepCount = (store: MemStore, step: number) => store.all().filter((w) => w.step === step).length;

describe('every close path refuses to end the price review approval without Mike', () => {
  it('resolveWait refuses completed, sent, booked, signed, cancelled and made-up resolutions', async () => {
    for (const r of ['completed', 'sent', 'booked', 'signed', 'cancelled', 'proceeded_on_silence', 'stopped_by_reply', 'task_done', 'anything']) {
      const store = new MemStore();
      const w = approval(store);
      await expect(resolveWait(store, w, r, { now: NOW, source: 'user', actor_user_id: MIKE_USER_ID })).rejects.toBeInstanceOf(PriceReviewResolutionRefused);
      expect(store.get(w.id)!.state).toBe('waiting');
      expect(stepCount(store, 3)).toBe(0);
    }
  });

  it('refuses approved without terms, with terms not from a session, or with terms by someone else', async () => {
    const bads: Array<Record<string, unknown>> = [
      {},
      { approved_terms: { ...terms } },
      { approved_terms: { ...terms, approved_by: MIKE_USER_ID } },
      { approved_terms: { ...terms, approved_by: MIKE_USER_ID, approved_via: 'api_key' } },
      { approved_terms: { ...terms, approved_by: '99999999-9999-4999-8999-999999999999', approved_via: 'session' } },
      { approved_terms: { new_amount_cents: 0, period: 'monthly', effective_on: '2026-12-15', approved_by: MIKE_USER_ID, approved_via: 'session' } },
    ];
    for (const payload of bads) {
      const store = new MemStore();
      const w = approval(store, payload);
      await expect(resolveByPerson(store, w, 'approved', { now: NOW, source: 'user', actor_user_id: MIKE_USER_ID })).rejects.toBeInstanceOf(PriceReviewResolutionRefused);
      expect(store.get(w.id)!.state).toBe('waiting');
    }
  });

  it('refuses declined without a denial from Mike\'s session', async () => {
    for (const payload of [{}, { price_review_denial: { denied_by: MIKE_USER_ID, denied_via: 'api_key' } }, { price_review_denial: { denied_by: 'x', denied_via: 'session' } }]) {
      const store = new MemStore();
      const w = approval(store, payload);
      await expect(resolveWait(store, w, 'declined', { now: NOW, source: 'user' })).rejects.toBeInstanceOf(PriceReviewResolutionRefused);
    }
  });

  it('lets a complete approval and a complete denial through', async () => {
    const s1 = new MemStore();
    const a = approval(s1, { approved_terms: { ...terms, approved_by: MIKE_USER_ID, approved_via: 'session' } });
    await resolveWait(s1, a, 'approved', { now: NOW, source: 'user', actor_user_id: MIKE_USER_ID });
    expect(stepCount(s1, 3)).toBe(1);
    const s2 = new MemStore();
    const d = approval(s2, { price_review_denial: { denied_by: MIKE_USER_ID, denied_via: 'session' } });
    await resolveWait(s2, d, 'declined', { now: NOW, source: 'user', actor_user_id: MIKE_USER_ID });
    expect(s2.get(d.id)!.state).toBe('done');
  });

  it('does not touch any other wait', () => {
    const w = { template_key: 'build.gate_mike', step: 2, action_payload: {} } as unknown as WaitRow;
    expect(() => assertPriceReviewResolution(w, 'completed')).not.toThrow();
    const first = { template_key: 'charter.price_review', step: 1, action_payload: {} } as unknown as WaitRow;
    expect(() => assertPriceReviewResolution(first, 'completed')).not.toThrow();
  });

  it('a placement event naming the approval wait cannot close it, and does not fail the batch', async () => {
    const store = new MemStore();
    const w = approval(store);
    const r = await applyWaitEvent(store, { event_id: 'stop1', kind: 'stop', target: w.id, payload: { reason: 'reply' } }, NOW);
    expect(r.applied).toEqual([expect.objectContaining({ wait_id: w.id, action: 'refused' })]);
    expect(store.get(w.id)!.state).toBe('waiting');
    expect(stepCount(store, 3)).toBe(0);
  });
});
