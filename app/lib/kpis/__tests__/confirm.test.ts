import { describe, it, expect } from 'vitest';
import { planKpiConfirmation, type ExistingKpi } from '../confirm';
import type { KpiProposalItem } from '../proposal';

const NOW = new Date('2026-10-24T12:00:00Z');
const ctx = { client_id: 'cl', accord_id: 'ac', now: NOW };
const items: KpiProposalItem[] = [
  { metric: 'sessions', label: 'More visits', direction: 'up', baseline_value: 1000, target_value: 1500, target_by: '2027-03-31', source: 'ga4' },
  { metric: 'leads', label: 'More enquiries', direction: 'up', source: 'manual' },
];

describe('planKpiConfirmation', () => {
  it('creates a confirmed row per item with confirmed_at set', () => {
    const plan = planKpiConfirmation(items, [], ctx);
    expect(plan.confirm).toEqual([]);
    expect(plan.create).toHaveLength(2);
    expect(plan.create[0]).toMatchObject({
      client_id: 'cl',
      accord_id: 'ac',
      site_id: null,
      status: 'confirmed',
      confirmed_at: NOW,
      baseline_value: 1000,
      baseline_at: NOW,
      target_value: 1500,
    });
    expect(plan.create[0].target_by?.toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(plan.create[1]).toMatchObject({ baseline_value: null, baseline_at: null, target_value: null, target_by: null });
  });
  it('is idempotent: rows that already exist are left alone', () => {
    const existing: ExistingKpi[] = [
      { id: 'k1', metric: 'sessions', site_id: null, status: 'confirmed' },
      { id: 'k2', metric: 'leads', site_id: null, status: 'confirmed' },
    ];
    const plan = planKpiConfirmation(items, existing, ctx);
    expect(plan).toEqual({ create: [], confirm: [], unchanged: ['sessions', 'leads'] });
  });
  it('confirms a proposed row instead of duplicating it', () => {
    const plan = planKpiConfirmation(items, [{ id: 'k1', metric: 'sessions', site_id: null, status: 'proposed' }], ctx);
    expect(plan.confirm).toEqual(['k1']);
    expect(plan.create.map((c) => c.metric)).toEqual(['leads']);
  });
  it('never revives a retired row', () => {
    const plan = planKpiConfirmation(items, [{ id: 'k1', metric: 'sessions', site_id: null, status: 'retired' }], ctx);
    expect(plan.confirm).toEqual([]);
    expect(plan.unchanged).toEqual(['sessions']);
    expect(plan.create.map((c) => c.metric)).toEqual(['leads']);
  });
  it('uses the item site, else the default site, else none', () => {
    const withSite: KpiProposalItem[] = [{ ...items[0], site_id: 'site-a' }, items[1]];
    const plan = planKpiConfirmation(withSite, [], { ...ctx, default_site_id: 'site-d', charter_id: 'ch' });
    expect(plan.create.map((c) => c.site_id)).toEqual(['site-a', 'site-d']);
    expect(plan.create[0].charter_id).toBe('ch');
  });
});
