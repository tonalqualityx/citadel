import { describe, it, expect } from 'vitest';
import * as copy from '../copy';

describe('inviteText', () => {
  it('removes b and a tags, keeps an outside link as text', () => {
    const t = copy.inviteText('<b>Agenda</b><br>Read <a href="https://evil.example">https://evil.example</a> first');
    expect(t).toBe('Agenda Read https://evil.example first');
    expect(t).not.toMatch(/[<>]/);
  });
  it('decodes the common entities and collapses space', () => {
    expect(copy.inviteText('Tom &amp; Jerry &lt;3  &quot;hi&quot; &#39;x&#39;&nbsp;y')).toBe('Tom & Jerry <3 "hi" \'x\' y');
  });
  it('cuts at 600 characters on a word', () => {
    const t = copy.inviteText('word '.repeat(300)) as string;
    expect(t.length).toBeLessThanOrEqual(600);
    expect(t.endsWith('word')).toBe(true);
  });
  it('is null when empty, and swaps a dash for a comma', () => {
    expect(copy.inviteText('  <br> ')).toBeNull();
    expect(copy.inviteText('a — b')).toBe('a, b');
  });
});

describe('labels', () => {
  it('lists names', () => {
    expect(copy.nameList(['Morgan'])).toBe('Morgan');
    expect(copy.nameList(['Morgan', 'Dan'])).toBe('Morgan and Dan');
    expect(copy.nameList(['Morgan', 'Dan', 'A', 'B'])).toBe('Morgan, Dan and 2 more');
  });
  it('writes the all day line', () => {
    expect(copy.allDayLine(['Home'])).toBe('All day: Home');
    expect(copy.allDayLine(['Home', 'Veterans Day', 'X'])).toBe('All day: Home, Veterans Day and 1 more');
    expect(copy.allDayLine([])).toBeNull();
  });
  it('safeText removes addresses and dashes', () => {
    expect(copy.safeText('Lunch – a@b.com now')).toBe('Lunch, now');
    expect(copy.safeText('x@y')).toBe('');
  });
  it('no exported string has a dash or a banned word', () => {
    const strings: string[] = [];
    for (const v of Object.values(copy)) {
      if (typeof v === 'string') strings.push(v);
    }
    strings.push(
      copy.earlierText(3), copy.laterText(2), copy.answerLabel('Jessica'), copy.answerLabel(null), copy.untilText('6:00'), copy.tomorrowTime('1:00'),
      copy.holdsReply('Morgan', 'Re: x'), copy.sessionQuestions(1, null), copy.sessionQuestions(3, 'Phil Camp'), copy.signOffWaits('P'), copy.needsYouNow('T'),
      copy.setAsideReply('Morgan', 'Friday'), copy.setAsideReply('Morgan', null), copy.matchedByContact('Morgan'), copy.matchedByLead('Erick'), copy.matchedByDomain('Dan'),
      copy.lastEmailLabel('Wednesday, November 11', 'Morgan', 'Tomorrow works'), copy.openClientLabel('VT Standard'), copy.dealLabel('X'), copy.notesLabel('October 28'), copy.monthlyReportLabel('October'),
    );
    for (const s of strings) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/priorit|overdue/i);
    }
  });
});
