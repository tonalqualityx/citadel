import { describe, it, expect } from 'vitest';
import { buildProvenance, canonicalNumber, extractResultNumbers, labelDates, maskText, MASK, DATE_MASK, MONEY_MASK, numbersInText, emptyProvenance } from '../provenance';

const GA = { tool: 'ga4_report', result_numbers: extractResultNumbers({ totals: { sessions: 20, engagementRate: 0.456 } }), label: 'Google Analytics, Oct 1 to Oct 20, 2026 (data through Oct 20)' };

describe('provenance', () => {
  it('canonicalises numbers as displayed', () => {
    expect(canonicalNumber('1,234.50')).toBe('1234.5');
    expect(canonicalNumber('$5')).toBe('5');
    expect(canonicalNumber('12%')).toBe('12');
    expect(canonicalNumber('abc')).toBeNull();
    expect(numbersInText('Oct 1 to Oct 20, 2026')).toEqual(['1', '20', '2026']);
  });

  it('extracts values only: not ids, invoice numbers, dates, GA4 date strings or labels', () => {
    const out = extractResultNumbers({
      sessions: '412', rate: 0.456, balance: 750.5, qbo_invoice_id: '99887', doc_number: '1042', txn_date: '2026-09-30',
      date: '20261001', created_at: 1761000000, uuid: '7c9e6679-7425-40de-944b-e07fc1f90ae7', label: 'Oct 1 to Oct 20, 2026',
    });
    expect(out).toContain('412');
    expect(out).toContain('pct:45.6');
    expect(out).toContain('money:750.5');
    expect(out).not.toContain('750.5');
    for (const bad of ['99887', '1042', '2026', '20261001', '1761000000', '7425', '30', '9']) expect(out).not.toContain(bad);
  });

  it('a fraction is shown to its own precision, never rounded to a whole number', () => {
    const prov = buildProvenance([{ tool: 'search_console', result_numbers: extractResultNumbers({ position: 12.4 }), label: null }]);
    expect(maskText('12.4', prov).masked).toBe(MASK);
    expect(maskText('12', prov).masked).toBe('12');
  });

  it('a money field backs only the exact dollar figure', () => {
    const prov = buildProvenance([{ tool: 'citadel_read', kind: 'invoices', result_numbers: extractResultNumbers({ balance: 750.5 }) }]);
    expect(maskText('$750.50', prov).masked).toBe(MONEY_MASK);
    expect(maskText('$751', prov).masked).toBe('$751');
    expect(maskText('750.5', prov).masked).toBe('750.5');
  });

  it('whole dates match a label date, only in a sentence that names the source', () => {
    const prov = buildProvenance([GA]);
    expect(maskText('Google Analytics, Oct 1 to Oct 20, 2026: 20 sessions.', prov).masked).toContain(`${DATE_MASK} to ${DATE_MASK}`);
    expect(maskText('It goes live Oct 20.', prov).promiseText).toBe('It goes live Oct 20.');
    expect(maskText('Google Analytics, Oct 5.', prov).promiseText).toBe('Google Analytics, Oct 5.');
    expect(maskText('Google Analytics, Oct 20, 2025.', prov).promiseText).toBe('Google Analytics, Oct 20, 2025.');
    expect(labelDates(GA.label).map((d) => d.y)).toEqual([2026, 2026, 2026]);
  });

  it('a count of 20 and the 20th of the month are different claims', () => {
    const r = maskText('Oct 20 had 20 sessions in Google Analytics.', buildProvenance([GA]));
    expect(r.analytics).toHaveLength(1);
  });

  it('the client\'s words back a number only inside quotes, plus a bare year', () => {
    const prov = buildProvenance([], ['500', '2024']);
    expect(maskText('You wrote "we pay 500" for it.', prov).masked).toContain(MASK);
    expect(maskText('That is 500 for it.', prov).masked).toContain('500');
    expect(maskText('The 2024 photo.', prov).masked).toContain(MASK);
  });

  it('unbacked numbers stay as digits', () => {
    expect(maskText('77 visitors', emptyProvenance()).masked).toBe('77 visitors');
  });
});
