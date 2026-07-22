import { describe, it, expect } from 'vitest';
import {
  stripSubjectPrefix,
  isDueSoon,
  extractEmailDomain,
  matchClientByEmailDomain,
} from '../email-asks';

describe('stripSubjectPrefix', () => {
  it('strips a single Re: prefix', () => {
    expect(stripSubjectPrefix('Re: Site is down')).toBe('Site is down');
  });

  it('strips a single Fwd: prefix', () => {
    expect(stripSubjectPrefix('Fwd: Invoice attached')).toBe('Invoice attached');
  });

  it('strips FW: (no d) case-insensitively', () => {
    expect(stripSubjectPrefix('FW: quarterly numbers')).toBe('quarterly numbers');
  });

  it('strips repeated/mixed Re:/Fwd: prefixes', () => {
    expect(stripSubjectPrefix('Re: Fwd: Re: Site down')).toBe('Site down');
  });

  it('is case-insensitive', () => {
    expect(stripSubjectPrefix('RE: something')).toBe('something');
    expect(stripSubjectPrefix('re: something')).toBe('something');
  });

  it('leaves a subject with no prefix untouched', () => {
    expect(stripSubjectPrefix('Site is down')).toBe('Site is down');
  });

  it('does not strip "Re:" mid-subject', () => {
    expect(stripSubjectPrefix('Question Re: the invoice')).toBe('Question Re: the invoice');
  });

  it('handles an empty subject', () => {
    expect(stripSubjectPrefix('')).toBe('');
  });

  it('trims surrounding whitespace after stripping', () => {
    expect(stripSubjectPrefix('  Re:   Site is down  ')).toBe('Site is down');
  });
});

describe('isDueSoon', () => {
  const now = new Date('2026-07-21T20:00:00.000Z'); // 8pm boundary case

  it('is true for a due date exactly at now', () => {
    expect(isDueSoon(now, now)).toBe(true);
  });

  it('is true for a due date 23 hours out', () => {
    const due = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    expect(isDueSoon(due, now)).toBe(true);
  });

  it('is true for a due date exactly 24 hours out (inclusive boundary)', () => {
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(isDueSoon(due, now)).toBe(true);
  });

  it('is false for a due date 24 hours + 1ms out', () => {
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
    expect(isDueSoon(due, now)).toBe(false);
  });

  it('is false for a due date already in the past', () => {
    const due = new Date(now.getTime() - 60 * 1000);
    expect(isDueSoon(due, now)).toBe(false);
  });

  // The exact trap the Phase 3 seed fixtures hit while baselining Phase 4a: a due date
  // that crosses a UTC calendar-day boundary must NOT be excluded just because its UTC
  // date differs from `now`'s UTC date — this is rolling real-time math, not calendar-day
  // math, so it is immune to that whole bug class by construction.
  it('correctly includes a due date that crosses the UTC midnight boundary (8pm ET trap)', () => {
    // now = 2026-07-21 20:00 ET (00:00 UTC on the 22nd already) — due 3h later, which
    // crosses into UTC 2026-07-22 03:00 while still being well within the 24h window.
    const nowEt = new Date('2026-07-22T00:00:00.000Z'); // 8pm ET on the 21st
    const dueLaterSameEvening = new Date('2026-07-22T03:00:00.000Z'); // 11pm ET on the 21st
    expect(isDueSoon(dueLaterSameEvening, nowEt)).toBe(true);
  });

  it('respects a custom window', () => {
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    expect(isDueSoon(due, now, 1)).toBe(false);
    expect(isDueSoon(due, now, 3)).toBe(true);
  });
});

describe('extractEmailDomain', () => {
  it('extracts the domain, lowercased', () => {
    expect(extractEmailDomain('Someone@Example.COM')).toBe('example.com');
  });

  it('returns null for a string with no @', () => {
    expect(extractEmailDomain('not-an-email')).toBeNull();
  });

  it('returns null when @ is the last character', () => {
    expect(extractEmailDomain('someone@')).toBeNull();
  });
});

describe('matchClientByEmailDomain', () => {
  const clients = [
    { id: 'c1', email: 'contact@herba.com' },
    { id: 'c2', email: null },
    { id: 'c3', email: 'hello@Widgets.io' },
  ];

  it('matches on domain, case-insensitively', () => {
    expect(matchClientByEmailDomain('jane@HERBA.com', clients)).toBe('c1');
  });

  it('matches ignoring the local part entirely', () => {
    expect(matchClientByEmailDomain('someone.else@widgets.io', clients)).toBe('c3');
  });

  it('skips clients with no email', () => {
    expect(matchClientByEmailDomain('anyone@noemail-domain.com', clients)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchClientByEmailDomain('person@unrelated.com', clients)).toBeNull();
  });

  it('returns null for an unparseable from_email', () => {
    expect(matchClientByEmailDomain('not-an-email', clients)).toBeNull();
  });
});
