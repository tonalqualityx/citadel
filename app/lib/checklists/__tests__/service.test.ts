import { describe, it, expect } from 'vitest';
import { blockingItems, isChecklistDone, isSatisfied, itemsFromTemplate, serializeChecklist } from '../service';
import { ONBOARDING_BUILD_TEMPLATE } from '../templates';

const rows = (overrides: Record<string, string> = {}) =>
  itemsFromTemplate(ONBOARDING_BUILD_TEMPLATE).map((r) => ({ ...r, state: overrides[r.key] ?? 'missing' }));

const SIX = ['people.approver', 'people.billing_contact', 'assets.logo', 'billing.msa', 'billing.first_payment', 'meeting.kickoff'];

describe('checklist done rule', () => {
  it('a fresh checklist is not done and is blocked on the six before-work items', () => {
    expect(isChecklistDone(rows())).toBe(false);
    expect(blockingItems(rows()).map((i) => i.key).sort()).toEqual([...SIX].sort());
  });
  it('is done when the six are verified, received, waived or not applicable', () => {
    const states = ['verified', 'received', 'waived', 'not_applicable', 'verified', 'received'];
    expect(isChecklistDone(rows(Object.fromEntries(SIX.map((k, i) => [k, states[i]]))))).toBe(true);
  });
  it('one missing before-work item keeps it open', () => {
    const o = Object.fromEntries(SIX.map((k) => [k, 'verified']));
    o['billing.first_payment'] = 'missing';
    expect(isChecklistDone(rows(o))).toBe(false);
    expect(blockingItems(rows(o)).map((i) => i.key)).toEqual(['billing.first_payment']);
  });
  it('before-launch items (GA4, Search Console, DNS) and optional items do not hold it open', () => {
    const o = Object.fromEntries(SIX.map((k) => [k, 'verified']));
    const r = rows(o);
    expect(r.find((i) => i.key === 'access.ga4')?.state).toBe('missing');
    expect(isChecklistDone(r)).toBe(true);
  });
  it('an unknown required key counts as before work; an unknown optional key does not', () => {
    const o = Object.fromEntries(SIX.map((k) => [k, 'verified']));
    const extra = [...rows(o), { key: 'custom.thing', label: 'x', group: 'data', required: true, state: 'missing' }];
    expect(isChecklistDone(extra)).toBe(false);
    extra[extra.length - 1].required = false;
    expect(isChecklistDone(extra)).toBe(true);
  });
  it('an empty checklist is not done', () => {
    expect(isChecklistDone([])).toBe(false);
  });
  it('isSatisfied covers the four satisfied states only', () => {
    expect(['missing', 'received', 'verified', 'waived', 'not_applicable'].filter(isSatisfied)).toEqual(['received', 'verified', 'waived', 'not_applicable']);
  });
});

describe('serializeChecklist', () => {
  it('adds client_label, gate and the blocking keys', () => {
    const items = rows().map((r) => ({ ...r, verified_by_id: null, verified_at: null, evidence: null }));
    const out = serializeChecklist({ id: 'c', kind: 'onboarding', client_id: 'cl', accord_id: null, charter_id: null, project_id: null, started_at: new Date(), done_at: null, items });
    expect(out.done).toBe(false);
    expect(out.blocking_keys.sort()).toEqual([...SIX].sort());
    expect(out.items.find((i) => i.key === 'access.ga4')).toMatchObject({ gate: 'before_launch', client_label: 'Access to your Google Analytics' });
    expect(out.items.find((i) => i.key === 'assets.logo')?.gate).toBe('before_work');
    expect(out.items.find((i) => i.key === 'assets.photos')?.gate).toBe('none');
  });
});
