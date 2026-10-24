import { describe, it, expect } from 'vitest';
import { validateKpiProposal } from '../proposal';

const good = { metric: 'sessions', label: 'More visits to the site', direction: 'up', source: 'ga4' };

describe('validateKpiProposal', () => {
  it('accepts a minimal item and a full item', () => {
    const r = validateKpiProposal([
      good,
      { metric: 'rank:septic pumping', label: 'Rank for septic pumping', direction: 'up', baseline_value: 14, target_value: 3, target_by: '2027-03-31', source: 'gsc', site_id: '11111111-1111-4111-8111-111111111111' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.items[1]).toMatchObject({ baseline_value: 14, target_value: 3, target_by: '2027-03-31' });
    }
  });
  it('accepts an empty proposal', () => {
    expect(validateKpiProposal([])).toEqual({ ok: true, items: [] });
  });
  it('rejects anything that is not an array of objects', () => {
    expect(validateKpiProposal(null).ok).toBe(false);
    expect(validateKpiProposal({ metric: 'x' }).ok).toBe(false);
    expect(validateKpiProposal(['sessions']).ok).toBe(false);
    expect(validateKpiProposal([[]]).ok).toBe(false);
  });
  it('lists every problem with its position', () => {
    const r = validateKpiProposal([{ ...good, direction: 'sideways', source: 'tiktok' }, { ...good, metric: '', label: 'x'.repeat(201) }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('|')).toMatch(/\[0\]\.direction/);
      expect(r.errors.join('|')).toMatch(/\[0\]\.source/);
      expect(r.errors.join('|')).toMatch(/\[1\]\.metric/);
      expect(r.errors.join('|')).toMatch(/\[1\]\.label/);
    }
  });
  it('rejects bad numbers, dates and ids', () => {
    expect(validateKpiProposal([{ ...good, target_value: '10' }]).ok).toBe(false);
    expect(validateKpiProposal([{ ...good, baseline_value: Number.NaN }]).ok).toBe(false);
    expect(validateKpiProposal([{ ...good, target_value: 1e15 }]).ok).toBe(false);
    expect(validateKpiProposal([{ ...good, target_by: '2027-02-30' }]).ok).toBe(false);
    expect(validateKpiProposal([{ ...good, target_by: 'next spring' }]).ok).toBe(false);
    expect(validateKpiProposal([{ ...good, site_id: 'abc' }]).ok).toBe(false);
  });
  it('rejects a repeated metric for the same site but allows it for different sites', () => {
    expect(validateKpiProposal([good, good]).ok).toBe(false);
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    expect(validateKpiProposal([{ ...good, site_id: a }, { ...good, site_id: b }]).ok).toBe(true);
  });
  it('caps the size of a proposal', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...good, metric: `m${i}` }));
    expect(validateKpiProposal(many).ok).toBe(false);
  });
  it('drops unknown keys from clean items', () => {
    const r = validateKpiProposal([{ ...good, status: 'confirmed', note: 'x' }]);
    expect(r.ok && Object.keys(r.items[0]).sort()).toEqual(['direction', 'label', 'metric', 'source']);
  });
});
