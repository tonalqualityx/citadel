import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { formatWaiting, isActivelyWaiting } from '@/lib/tasks/waiting-format';
import { notActivelyWaitingWhere, parseFollowUp } from '@/lib/tasks/waiting';

// Waiting on someone (task 23cd54cf): the card is off Mike's lists while marked and before its follow-up time.
const NOW = new Date('2026-11-26T21:00:00Z');
const base = { waiting_since: new Date('2026-11-26T20:00:00Z'), waiting_on_name: 'Dan Wargo', status: 'not_started' };

describe('isActivelyWaiting', () => {
  it('is false with no mark', () => {
    expect(isActivelyWaiting({ status: 'not_started' }, NOW)).toBe(false);
  });
  it('is true with a mark and no follow-up date, or a future one', () => {
    expect(isActivelyWaiting(base, NOW)).toBe(true);
    expect(isActivelyWaiting({ ...base, waiting_follow_up_at: new Date('2026-12-05T05:00:00Z') }, NOW)).toBe(true);
  });
  it('is false once the follow-up time is reached', () => {
    expect(isActivelyWaiting({ ...base, waiting_follow_up_at: NOW }, NOW)).toBe(false);
  });
  it('is false on a done or abandoned card', () => {
    expect(isActivelyWaiting({ ...base, status: 'done' }, NOW)).toBe(false);
    expect(isActivelyWaiting({ ...base, status: 'abandoned' }, NOW)).toBe(false);
  });
});

describe('formatWaiting', () => {
  it('is null on an unmarked card', () => {
    expect(formatWaiting({ status: 'not_started' }, NOW)).toBeNull();
  });
  it('reports active and follow_up_due', () => {
    expect(formatWaiting({ ...base, waiting_follow_up_at: new Date('2026-11-26T20:30:00Z') }, NOW)).toMatchObject({
      name: 'Dan Wargo',
      active: false,
      follow_up_due: true,
      follow_up_sent_at: null,
    });
    expect(formatWaiting({ ...base, waiting_follow_up_at: new Date('2026-12-05T05:00:00Z') }, NOW)).toMatchObject({ active: true, follow_up_due: false });
  });
});

describe('parseFollowUp', () => {
  it('reads a bare date as the end of that day in Eastern time', () => {
    expect(parseFollowUp('2026-12-04').toISOString()).toBe('2026-12-05T05:00:00.000Z');
    // Summer time: the end of July 4 is 04:00 UTC on July 5; a month end rolls over.
    expect(parseFollowUp('2026-07-04').toISOString()).toBe('2026-07-05T04:00:00.000Z');
    expect(parseFollowUp('2026-12-31').toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
  it('takes a full ISO time as given', () => {
    expect(parseFollowUp('2026-12-04T15:00:00Z').toISOString()).toBe('2026-12-04T15:00:00.000Z');
  });
  it('refuses nonsense', () => {
    expect(() => parseFollowUp('next week')).toThrow();
    expect(() => parseFollowUp('2026-13-01')).toThrow();
  });
});

describe('notActivelyWaitingWhere', () => {
  it('keeps unmarked cards and cards whose follow-up time has passed', () => {
    expect(notActivelyWaitingWhere(NOW)).toEqual({ OR: [{ waiting_since: null }, { waiting_follow_up_at: { lte: NOW } }] });
  });
});
