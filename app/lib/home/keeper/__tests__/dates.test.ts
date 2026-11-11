import { describe, expect, it } from 'vitest';
import { taskKey } from '../../item-key';
import { classifyDate, planDates } from '../dates';
import { d, makeClient, makeState, makeTask } from '../../__tests__/fixtures/tonight';

const NOW = d('2026-11-11T07:35:00Z');

describe('classifyDate', () => {
  it('sets aside a due date 4 to 6 days after creation (the invented default)', () => {
    for (const days of [4, 5, 6]) {
      const created = d('2026-11-05T15:00:00Z');
      const due = new Date(Date.UTC(2026, 10, 5 + days));
      expect(classifyDate(makeTask({ created_at: created, due_date: due }), undefined, NOW)).toBe('set_aside');
    }
  });

  it('sets aside a date more than 14 days in the past', () => {
    const t = makeTask({ created_at: d('2026-09-01T15:00:00Z'), due_date: d('2026-10-01T00:00:00Z') });
    expect(classifyDate(t, undefined, NOW)).toBe('set_aside');
  });

  it('reads anything else, including 3 and 7 days after creation and a date 14 days back', () => {
    const created = d('2026-11-01T15:00:00Z');
    for (const due of ['2026-11-04', '2026-11-08', '2026-11-25']) {
      expect(classifyDate(makeTask({ created_at: created, due_date: d(`${due}T00:00:00Z`) }), undefined, NOW)).toBe('read');
    }
    expect(classifyDate(makeTask({ created_at: d('2026-10-01T15:00:00Z'), due_date: d('2026-10-28T00:00:00Z') }), undefined, NOW)).toBe('read');
  });

  it('leaves alone: no date, a real hard date, a promise, job-watch or lifeline tags, and a date read before', () => {
    const base = { created_at: d('2026-10-20T15:00:00Z'), due_date: d('2026-11-25T00:00:00Z') };
    expect(classifyDate(makeTask({ created_at: base.created_at }), undefined, NOW)).toBeNull();
    expect(classifyDate(makeTask({ ...base, hard_due_at: d('2026-11-20T00:00:00Z'), hard_due_source: 'domain renews' }), undefined, NOW)).toBeNull();
    expect(classifyDate(makeTask({ ...base, promised_to: 'Jill' }), undefined, NOW)).toBeNull();
    expect(classifyDate(makeTask({ ...base, tags: ['job-watch'] }), undefined, NOW)).toBeNull();
    expect(classifyDate(makeTask({ ...base, tags: ['lifeline'] }), undefined, NOW)).toBeNull();
    const t = makeTask(base);
    expect(classifyDate(t, makeState(taskKey(t.id), { dates_read_at: d('2026-11-01T00:00:00Z') }), NOW)).toBeNull();
  });
});

describe('planDates', () => {
  it('lists each task once with its class, date and whether it is client work', () => {
    const client = makeClient('Jill Cafe');
    const a = makeTask({ title: 'A', created_at: d('2026-10-20T15:00:00Z'), due_date: d('2026-11-25T00:00:00Z') });
    const b = makeTask({ title: 'B', created_at: d('2026-11-01T15:00:00Z'), due_date: d('2026-11-06T00:00:00Z'), client });
    const p = planDates([a, b, makeTask({ title: 'No date' })], [], NOW);
    expect(p).toEqual([
      { item_key: taskKey(a.id), title: 'A', outcome: 'read', due_date: '2026-11-25', client_facing: false },
      { item_key: taskKey(b.id), title: 'B', outcome: 'set_aside', due_date: '2026-11-06', client_facing: true },
    ]);
  });
});
