// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { normalizeRfc } from '../link-asks';
import { fromLabel, shortDate, taskClosedLine, backfillLine, catchupLine, emailLinkLabel } from '../copy';
import { backfillBodySchema } from '../backfill';
import { isSecurityTagged, readWorkCloseRecord, reasonFor, isFinishedStatus } from '../ask-closure';

describe('normalizeRfc', () => {
  it('lowercases and strips brackets and space', () => {
    expect(normalizeRfc('  <ABC.def@Mail.Gmail.com> ')).toBe('abc.def@mail.gmail.com');
    expect(normalizeRfc('')).toBeNull();
    expect(normalizeRfc(null)).toBeNull();
    expect(normalizeRfc('<>')).toBeNull();
  });
});

describe('the lines on his screen', () => {
  it('names the sender, the task and the date', () => {
    const d = new Date('2026-11-02T17:00:00Z');
    expect(taskClosedLine({ count: 2, from: ['Jeffrey Knisely', 'Jeffrey Knisely'], title: 'Add the blurb', status: 'done', date: d })).toBe('Closed 2 emails from Jeffrey Knisely: done in "Add the blurb" (Nov 2).');
    expect(taskClosedLine({ count: 1, from: ['A', 'B'], title: 'Old job', status: 'abandoned', date: d })).toBe('Closed 1 email from A and 1 other: "Old job" was dropped (Nov 2).');
    expect(backfillLine(37, 22)).toBe('Linked 37 emails to their tasks and closed 22 whose tasks are finished.');
    expect(catchupLine(1, 1)).toBe('Closed 1 email whose task is finished.');
    expect(fromLabel(['A', 'B', 'C'])).toBe('A and 2 others');
    expect(shortDate(d)).toBe('Nov 2');
    expect(emailLinkLabel({ from_name: 'Jeffrey Knisely', from_email: 'j@x.test', subject: 'Website update', received_at: d })).toBe('Email: Jeffrey Knisely, Nov 2: Website update');
  });

  it('swaps a dash from a stored subject and never says priority or overdue', () => {
    const d = new Date('2026-11-02T17:00:00Z');
    const lines = [
      taskClosedLine({ count: 1, from: ['A'], title: `Fix — the page`, status: 'done', date: d }),
      emailLinkLabel({ from_name: null, from_email: 'a@x.test', subject: 'One – two', received_at: d }),
      backfillLine(1, 1),
      catchupLine(3, 2),
    ].join('\n');
    expect(lines).not.toMatch(/[–—]/);
    expect(lines).not.toMatch(/priorit|overdue/i);
  });
});

describe('closure helpers', () => {
  it('finishes only on done or abandoned, with the matching reason', () => {
    expect(isFinishedStatus('done')).toBe(true);
    expect(isFinishedStatus('review')).toBe(false);
    expect(reasonFor('done')).toBe('task_done');
    expect(reasonFor('abandoned')).toBe('task_abandoned');
  });
  it('a security tag is read in any case', () => {
    expect(isSecurityTagged(['Security'])).toBe(true);
    expect(isSecurityTagged(['security-report'])).toBe(true);
    expect(isSecurityTagged(['lifeline', 'x'])).toBe(false);
    expect(isSecurityTagged(null)).toBe(false);
  });
  it('reads a stored close record and refuses junk', () => {
    const rec = { kind: 'work_close', origin: 'task', asks: [{ id: 'a', task_id: 't', closed_reason: 'task_done', previous_state: 'open' }], task_ids: ['t'] };
    expect(readWorkCloseRecord({ states: [], work_close: rec })).toEqual(rec);
    expect(readWorkCloseRecord({ states: [] })).toBeNull();
    expect(readWorkCloseRecord(null)).toBeNull();
    expect(readWorkCloseRecord({ work_close: { kind: 'other' } })).toBeNull();
  });
});

describe('the backfill body', () => {
  const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
  it('is strict, needs dry, and takes at most 500 pairs', () => {
    expect(backfillBodySchema.safeParse({ dry: true }).success).toBe(true);
    expect(backfillBodySchema.safeParse({ pairs: [] }).success).toBe(false);
    expect(backfillBodySchema.safeParse({ dry: true, extra: 1 }).success).toBe(false);
    const pair = { message_id: 'm', task_id: T, basis: 'source_ref' };
    expect(backfillBodySchema.safeParse({ dry: true, pairs: [pair] }).success).toBe(true);
    expect(backfillBodySchema.safeParse({ dry: true, pairs: [{ ...pair, basis: 'guess' }] }).success).toBe(false);
    expect(backfillBodySchema.safeParse({ dry: true, pairs: [{ ...pair, ask_id: T }] }).success).toBe(false);
    expect(backfillBodySchema.safeParse({ dry: true, pairs: [{ task_id: T, basis: 'registry' }] }).success).toBe(false);
    expect(backfillBodySchema.safeParse({ dry: true, pairs: Array.from({ length: 501 }, () => pair) }).success).toBe(false);
    expect(backfillBodySchema.safeParse({ dry: true, pairs: Array.from({ length: 500 }, () => pair) }).success).toBe(true);
  });
});
