import { describe, it, expect } from 'vitest';
import { formatRecurringWorkResponse } from '../formatters';

const base = { id: 'rw1', sort_order: 0, is_active: true, created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-01') };

describe('formatRecurringWorkResponse usage fields', () => {
  it('turns BigInt and Decimal columns into plain numbers', () => {
    const out = formatRecurringWorkResponse({
      ...base,
      usage_week_tokens: BigInt(5_000_000_000),
      usage_month_tokens: BigInt(1),
      usage_week_usd: { toString: () => '12.50', valueOf: () => '12.50' },
      usage_month_usd: '40.00',
      usage_week_share: '77.35',
      priority: 'low',
      destinations: ['slack'],
    });
    expect(out).toMatchObject({ usage_week_tokens: 5_000_000_000, usage_month_tokens: 1, usage_week_usd: 12.5, usage_month_usd: 40, usage_week_share: 77.35, priority: 'low' });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('defaults: nulls, empty destinations, normal priority, file_only false', () => {
    expect(formatRecurringWorkResponse(base)).toMatchObject({
      usage_week_tokens: null, usage_week_usd: null, usage_state: null, destinations: [], file_only: false, priority: 'normal', last_used_at: null,
    });
  });

  it('file_only is true only for a non-empty list of file_only', () => {
    const f = (destinations: string[]) => formatRecurringWorkResponse({ ...base, destinations }).file_only;
    expect(f(['file_only'])).toBe(true);
    expect(f(['file_only', 'file_only'])).toBe(true);
    expect(f(['file_only', 'email_mike'])).toBe(false);
    expect(f([])).toBe(false);
  });
});
