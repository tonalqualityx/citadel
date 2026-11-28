import { describe, it, expect } from 'vitest';
import { destinationWords, usageText, lastUsedText, nobodyReads, sortRows, filterRows, dollars } from '../board-logic';
import type { RecurringWorkItem } from '@/types/entities';

const r = (o: Partial<RecurringWorkItem> = {}) => ({ id: 'x', title: 't', ...o }) as RecurringWorkItem;
const NOW = new Date('2026-11-28T12:00:00Z');

describe('usageText', () => {
  it('measured shows the share and dollars, and the month', () => {
    expect(usageText(r({ usage_state: 'measured', usage_week_share: 12.4, usage_week_usd: 3.6, usage_month_usd: 12.2 }))).toEqual({ main: 'this week 12% · $4', month: 'month $12' });
  });
  it('under a dollar reads <$1', () => {
    expect(dollars(0.4)).toBe('<$1');
    expect(usageText(r({ usage_state: 'measured', usage_week_share: 0, usage_week_usd: 0.2, usage_month_usd: 0.9 })).month).toBe('month <$1');
  });
  it('covers the other states', () => {
    expect(usageText(r({ usage_state: 'no_claude' })).main).toBe('no Claude');
    expect(usageText(r({ usage_state: 'unmeasured' })).main).toBe('not measured');
    expect(usageText(r({ usage_state: null })).main).toBe('usage not known yet');
    expect(usageText(r()).main).toBe('usage not known yet');
  });
});

describe('destinationWords and lastUsedText', () => {
  it('uses human words and says when unknown', () => {
    expect(destinationWords(['email_mike', 'file_only'])).toBe('email to Mike, file on the machine');
    expect(destinationWords([])).toBe('destination not known yet');
    expect(destinationWords(null)).toBe('destination not known yet');
  });
  it('last used', () => {
    const fmt = () => 'Nov 24';
    expect(lastUsedText(r({ last_used_at: '2026-11-24T00:00:00Z' }), fmt)).toBe('used Nov 24');
    expect(lastUsedText(r({ destinations: ['slack'] }), fmt)).toBe('never used');
    expect(lastUsedText(r({ destinations: [] }), fmt)).toBe('use not known yet');
  });
});

describe('nobodyReads', () => {
  it('file only counts', () => expect(nobodyReads(r({ file_only: true, last_used_at: '2026-11-27T00:00:00Z' }), NOW)).toBe(true));
  it('unknown destinations do not count', () => expect(nobodyReads(r({ destinations: [] }), NOW)).toBe(false));
  it('all plumbing does not count', () => expect(nobodyReads(r({ destinations: ['machine_plumbing'] }), NOW)).toBe(false));
  it('known, never used counts', () => expect(nobodyReads(r({ destinations: ['slack'] }), NOW)).toBe(true));
  it('used over 30 days ago counts, recent does not', () => {
    expect(nobodyReads(r({ destinations: ['slack'], last_used_at: '2026-10-20T00:00:00Z' }), NOW)).toBe(true);
    expect(nobodyReads(r({ destinations: ['slack'], last_used_at: '2026-11-20T00:00:00Z' }), NOW)).toBe(false);
  });
  it('plumbing plus another destination is judged on use', () => {
    expect(nobodyReads(r({ destinations: ['machine_plumbing', 'slack'] }), NOW)).toBe(true);
  });
});

describe('sortRows and filterRows', () => {
  const a = r({ id: 'a', usage_week_share: 5, usage_week_usd: 1, last_run_at: '2026-11-01T00:00:00Z' });
  const b = r({ id: 'b', usage_week_share: 20, usage_week_usd: 1, last_run_at: null });
  const c = r({ id: 'c', usage_week_share: null, usage_week_usd: null, last_run_at: '2026-11-20T00:00:00Z' });
  const d = r({ id: 'd', usage_week_share: 5, usage_week_usd: 9, last_run_at: '2026-11-10T00:00:00Z' });
  const ids = (x: RecurringWorkItem[]) => x.map((i) => i.id).join('');
  it('default keeps order', () => expect(ids(sortRows([a, b, c, d], 'default'))).toBe('abcd'));
  it('usage: share desc, then dollars, unknown last', () => expect(ids(sortRows([a, b, c, d], 'usage'))).toBe('bdac'));
  it('last run: newest first, never last', () => expect(ids(sortRows([a, b, c, d], 'last_run'))).toBe('cdab'));
  it('does not mutate the input', () => {
    const rows = [a, b];
    sortRows(rows, 'usage');
    expect(ids(rows)).toBe('ab');
  });
  it('filter', () => {
    const f = r({ id: 'f', file_only: true });
    expect(ids(filterRows([a, f], true, NOW))).toBe('f');
    expect(ids(filterRows([a, f], false, NOW))).toBe('af');
  });
});
