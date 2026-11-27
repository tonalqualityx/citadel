import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { summarize, ledgerSummary } from '../service';

const d = (day: string, o: Record<string, unknown>) => ({
  day: new Date(`${day}T00:00:00Z`), model: 'opus', task_type: 'chat', runs: 1, cards: 0, finished: 0, first_try: 0, escalations: 0, cost_usd: 1, ...o,
});

describe('summarize', () => {
  it('leaves card numbers empty for runs with no cards and sorts the most expensive first', () => {
    const s = summarize([d('2026-11-27', { cost_usd: 1 }), d('2026-11-27', { model: 'sonnet', task_type: 'site-repo', cards: 2, finished: 2, first_try: 2, cost_usd: 6 })], 7, '2026-11-21');
    expect(s.lines[0]).toMatchObject({ model: 'sonnet', first_try_rate: 1, cost_per_finished_card: 3 });
    expect(s.lines[1]).toMatchObject({ model: 'opus', first_try_rate: null, cost_per_finished_card: null });
    expect(s.total_cost_usd).toBe(7);
    expect(s.total_runs).toBe(2);
  });

  it('counts the window back from today in Eastern time', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const s = await ledgerSummary(7, new Date('2026-11-28T03:00:00Z'), { modelLedgerDay: { findMany } } as never);
    expect(s.since).toBe('2026-11-21'); // 22:00 on Nov 27 in New York: today is Nov 27
    expect(s.latest_day).toBeNull();
  });
});
