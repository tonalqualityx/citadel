import { describe, it, expect } from 'vitest';
import * as copy from '../copy';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-11T15:00:00Z');

describe('stripMikePrefix', () => {
  it('removes the leading "Mike, " and starts the sentence with a capital', () => {
    expect(copy.stripMikePrefix('Mike, send the Figma file to Lisa.')).toBe('Send the Figma file to Lisa.');
    expect(copy.stripMikePrefix('mike, review the sign-off')).toBe('Review the sign-off');
  });
  it('leaves other names and a Mike later in the sentence alone', () => {
    expect(copy.stripMikePrefix('Michael, call back')).toBe('Michael, call back');
    expect(copy.stripMikePrefix('Ask Mike, then send')).toBe('Ask Mike, then send');
  });
  it('swaps dashes out', () => {
    expect(copy.stripMikePrefix('Mike, wait — then send')).toBe('Wait, then send');
  });
});

describe('dates', () => {
  it('writes the weekday inside two weeks and not after', () => {
    expect(copy.sinceDay(new Date('2026-11-03T15:00:00Z'), NOW, TZ)).toBe('Tuesday, November 3');
    expect(copy.sinceDay(new Date('2026-10-20T15:00:00Z'), NOW, TZ)).toBe('October 20');
  });
  it('counts calendar days in the zone, not 24-hour periods', () => {
    expect(copy.calendarDays(new Date('2026-11-10T03:00:00Z'), new Date('2026-11-11T15:00:00Z'), TZ)).toBe(2);
    expect(copy.calendarDays(new Date('2026-11-11T14:00:00Z'), NOW, TZ)).toBe(0);
  });
  it('singular and plural days', () => {
    expect(copy.daysText(1)).toBe('1 day');
    expect(copy.daysText(22)).toBe('22 days');
  });
});

describe('next step lines', () => {
  it('Bast wrote this at the clock time today, or on a date', () => {
    expect(copy.nextStepSource({ source: 'bast', at: '2026-11-11T08:00:00Z' }, NOW, TZ)).toBe('Bast wrote this at 3:00 am today.');
    expect(copy.nextStepSource({ source: 'bast', at: '2026-11-03T08:00:00Z' }, NOW, TZ)).toBe('Bast wrote this on Tuesday, November 3.');
    expect(copy.nextStepSource({ source: 'none', at: null }, NOW, TZ)).toBeNull();
  });
  it('Yours, or the owner by name', () => {
    expect(copy.nextStepOwner({ owner: { id: 'u1', name: 'Mike' }, owner_label: null }, 'u1')).toBe('Yours');
    expect(copy.nextStepOwner({ owner: { id: 'u2', name: 'Lisa' }, owner_label: null }, 'u1')).toBe("Lisa's");
    expect(copy.nextStepOwner({ owner: null, owner_label: 'Andy (client)' }, 'u1')).toBe("Andy (client)'s");
    expect(copy.nextStepOwner({ owner: null, owner_label: null }, 'u1')).toBeNull();
  });
});

describe('last email line', () => {
  it('weekday, month day, name, then the gist or the subject', () => {
    const e = { from: 'Pat Smith', subject: 'Re: logo', gist: 'Pat approved the logo.', received_at: '2026-11-09T15:00:00Z' };
    expect(copy.lastEmailText(e, TZ)).toBe('Last client email: Monday, November 9, Pat Smith: Pat approved the logo.');
    expect(copy.lastEmailText({ ...e, gist: null }, TZ)).toBe('Last client email: Monday, November 9, Pat Smith: Re: logo');
  });
});

describe('words on the screen', () => {
  it('has no dash and none of the banned words', () => {
    const strings = (Object.values(copy) as unknown[]).filter((v): v is string => typeof v === 'string');
    for (const s of strings) expect(s).not.toMatch(/[–—]|priorit|overdue/i);
    expect(copy.joinPhrases(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
