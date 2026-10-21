import { describe, it, expect } from 'vitest';
import { buildProvenance, canonicalNumber, extractResultNumbers, isDateLike, maskText, MASK, numbersInText, emptyProvenance } from '../provenance';

describe('provenance', () => {
  it('canonicalises numbers as displayed', () => {
    expect(canonicalNumber('1,234.50')).toBe('1234.5');
    expect(canonicalNumber('$5')).toBe('5');
    expect(canonicalNumber('12%')).toBe('12');
    expect(canonicalNumber('abc')).toBeNull();
    expect(numbersInText('Oct 1 to Oct 20, 2026')).toEqual(['1', '20', '2026']);
  });
  it('extracts numbers, strings of digits, dates and money, and skips ids', () => {
    const out = extractResultNumbers({ sessions: '412', rate: 0.456, balance: 750.5, qbo_invoice_id: '99887', day: '2026-09-30', label: 'Oct 1' });
    expect(out).toContain('412');
    expect(out).toContain('pct:45.6');
    expect(out).toContain('money:750.5');
    expect(out).toContain('2026');
    expect(out).not.toContain('99887');
  });
  it('a money field backs only exact dollar figures, not roundings', () => {
    const prov = buildProvenance([{ tool: 'citadel_read', kind: 'invoices', result_numbers: extractResultNumbers({ balance: 750.5 }) }]);
    expect(maskText('$750.50', prov).masked).toBe(MASK);
    expect(maskText('$751', prov).masked).toBe('$751');
  });
  it('date parts are not analytics claims', () => {
    const prov = buildProvenance([{ tool: 'ga4_report', result_numbers: extractResultNumbers({ sessions: 20 }), label: 'Google Analytics, Oct 1 to Oct 20, 2026' }]);
    const r = maskText('Oct 20 had 20 sessions', prov);
    expect(r.analytics).toHaveLength(1);
    expect(isDateLike('20', 'Oct ', ', 2026')).toBe(true);
    expect(isDateLike('1234', '', '')).toBe(false);
  });
  it('unbacked numbers stay as digits', () => {
    expect(maskText('77 visitors', emptyProvenance()).masked).toBe('77 visitors');
  });
});
