import { describe, it, expect } from 'vitest';
import * as copy from '../copy';

const DASH = /[–—]/;
const BANNED = /priority|priorities|overdue/i;

describe('emergency copy', () => {
  const strings: string[] = [];
  for (const v of Object.values(copy)) if (typeof v === 'string') strings.push(v);
  strings.push(
    copy.scopeLabelSender('a@b.com'),
    copy.scopeLabelDomain('b.com'),
    copy.scopeLabelSite('b.com'),
    copy.ruleSentence('sender', 'a@b.com'),
    copy.ruleSentence('domain', 'b.com'),
    copy.ruleSentence('site', 'b.com'),
    copy.ruleDecisionTitle('site', 'b.com'),
    copy.ruleSavedLine('domain', 'b.com'),
    copy.siteDownTitle('b.com'),
    copy.siteDownDetail({ client: 'X', downMinutes: 35, checkedAgoMinutes: 3 }),
    copy.siteClearedLine('b.com', 23),
    copy.siteAnswersAgainMailLine('b.com', new Date('2026-11-11T15:42:00Z'), 'America/New_York'),
    copy.handsTitle(3, 45)
  );

  it('has no em or en dash and none of the banned words', () => {
    for (const s of strings) {
      expect(s, s).not.toMatch(DASH);
      expect(s, s).not.toMatch(BANNED);
    }
  });
  it('reads the way the plan words it', () => {
    expect(copy.SECURITY_NEVER_RULE).toBe('A security flag is never turned into a rule.');
    expect(copy.ruleSavedLine('sender', 'alerts@wpmudev.com')).toBe('Saved a rule: mail from alerts@wpmudev.com is not an emergency.');
    expect(copy.ruleDecisionTitle('site', 'jillscafe.com')).toBe('Not an emergency: jillscafe.com going down is not an emergency');
    expect(copy.siteClearedLine('jillscafe.com', 23)).toBe('jillscafe.com answers again. It was down 23 minutes.');
    expect(copy.siteAnswersAgainMailLine('jillscafe.com', new Date('2026-11-11T15:42:00Z'), 'America/New_York')).toBe(
      'jillscafe.com answers again (checked 10:42).'
    );
    expect(copy.siteDownDetail({ client: null, downMinutes: 0, checkedAgoMinutes: 0 })).toBe(
      'down less than a minute · checked again just now'
    );
    expect(copy.SITE_KUMA_IF_IGNORED).toBe(
      'The watchdog already told you on Slack and keeps checking every 2 minutes. This row clears when the site answers.'
    );
  });
  it('stored text goes through displayText', () => {
    expect(copy.scopeLabelDomain('a—b.com')).not.toMatch(DASH);
    expect(copy.siteDownDetail({ client: 'Jill — Cafe', downMinutes: 5, checkedAgoMinutes: null })).not.toMatch(DASH);
  });
});

describe('durations', () => {
  it('says exact minutes under two hours, then hours, then days', () => {
    expect(copy.siteClearedLine('a.com', 1)).toContain('1 minute.');
    expect(copy.siteClearedLine('a.com', 119)).toContain('119 minutes.');
    expect(copy.siteClearedLine('a.com', 180)).toContain('3 hours.');
    expect(copy.siteClearedLine('a.com', 60 * 50)).toContain('2 days.');
  });
});
