import { describe, it, expect } from 'vitest';
import { buildSignals, SIGNALS_EMPTY_COPY } from '../signals-rail-logic';

describe('buildSignals', () => {
  it('returns no signals when everything is zero', () => {
    expect(buildSignals({ crisisCount: 0, promisedDueTodayCount: 0, sessionsNeedingYouCount: 0 })).toEqual([]);
  });

  it('the empty-state sentence is exact (DAY-REALITY #6 — it is the product)', () => {
    expect(SIGNALS_EMPTY_COPY).toBe('Nothing needs you right now — if it did, it would be here.');
  });

  it('orders crisis > promised-due-today > sessions-needing-you', () => {
    const signals = buildSignals({ crisisCount: 1, promisedDueTodayCount: 1, sessionsNeedingYouCount: 1 });
    expect(signals.map((s) => s.kind)).toEqual(['crisis', 'promised_due_today', 'session_needs_you']);
  });

  it('omits zero-count entries individually', () => {
    const signals = buildSignals({ crisisCount: 0, promisedDueTodayCount: 2, sessionsNeedingYouCount: 0 });
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('promised_due_today');
    expect(signals[0].count).toBe(2);
  });

  it('crisis is tone "error"; the others are tone "warning" (never red for aging/capacity, but crisis IS an emergency)', () => {
    const signals = buildSignals({ crisisCount: 1, promisedDueTodayCount: 1, sessionsNeedingYouCount: 1 });
    expect(signals.find((s) => s.kind === 'crisis')?.tone).toBe('error');
    expect(signals.find((s) => s.kind === 'promised_due_today')?.tone).toBe('warning');
    expect(signals.find((s) => s.kind === 'session_needs_you')?.tone).toBe('warning');
  });

  it('pluralizes labels correctly for count 1 vs N', () => {
    const one = buildSignals({ crisisCount: 1, promisedDueTodayCount: 0, sessionsNeedingYouCount: 0 });
    const many = buildSignals({ crisisCount: 3, promisedDueTodayCount: 0, sessionsNeedingYouCount: 0 });
    expect(one[0].label).toContain('item needs');
    expect(many[0].label).toContain('items need');
  });
});
