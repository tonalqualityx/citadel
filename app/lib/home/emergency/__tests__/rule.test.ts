import { describe, it, expect } from 'vitest';
import {
  domainRuleAllowed,
  matchesNotEmergencyRule,
  normalizeHost,
  OWN_DOMAINS,
  parseRuleKey,
  ruleKey,
  ruleScopesFor,
  RULE_KEY_MAX,
} from '../rule';

describe('ruleScopesFor', () => {
  it('crisis mail from a company gives sender and domain, with the screen labels', () => {
    const s = ruleScopesFor({ kind: 'crisis', from_email: 'Alerts@WPMUdev.com' });
    expect(s).toEqual([
      { scope: 'sender', value: 'alerts@wpmudev.com', label: 'Mail from alerts@wpmudev.com' },
      { scope: 'domain', value: 'wpmudev.com', label: 'Mail from anyone at wpmudev.com' },
    ]);
  });
  it('free mail gets the sender choice only', () => {
    const s = ruleScopesFor({ kind: 'crisis', from_email: 'someone@gmail.com' });
    expect(s.map((x) => x.scope)).toEqual(['sender']);
    expect(ruleScopesFor({ kind: 'crisis', from_email: 'x@icloud.com' }).map((x) => x.scope)).toEqual(['sender']);
  });
  it('our own domains get no domain choice, and our own address gets nothing', () => {
    expect(ruleScopesFor({ kind: 'crisis', from_email: 'noreply@becomeindelible.com' }).map((x) => x.scope)).toEqual(['sender']);
    expect(ruleScopesFor({ kind: 'crisis', from_email: 'mike@becomeindelible.com' })).toEqual([]);
    expect(OWN_DOMAINS).toContain('whoismikedion.com');
    expect(domainRuleAllowed('sub.becomeindelible.com')).toBe(false);
  });
  it('a site gives the site choice', () => {
    expect(ruleScopesFor({ kind: 'site', host: 'https://www.JillsCafe.com/' })).toEqual([
      { scope: 'site', value: 'jillscafe.com', label: 'jillscafe.com going down' },
    ]);
  });
  it('tasks, waits, sessions, reviews and threads get none', () => {
    for (const kind of ['task', 'wait', 'session', 'review', 'thread'] as const) expect(ruleScopesFor({ kind })).toEqual([]);
  });
  it('a bad address gets none', () => {
    expect(ruleScopesFor({ kind: 'crisis', from_email: 'nope' })).toEqual([]);
    expect(ruleScopesFor({ kind: 'crisis', from_email: null })).toEqual([]);
  });
});

describe('matchesNotEmergencyRule', () => {
  const rules = [
    { kind: 'sender' as const, value: 'alerts@wpmudev.com' },
    { kind: 'domain' as const, value: 'statuspage.io' },
    { kind: 'site' as const, value: 'jillscafe.com' },
  ];
  it('matches the exact sender and the exact domain', () => {
    expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: 'ALERTS@wpmudev.com' }, rules)).toBe(true);
    expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: 'anyone@statuspage.io' }, rules)).toBe(true);
  });
  it('does not match another sender at the same domain, or a subdomain', () => {
    expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: 'billing@wpmudev.com' }, rules)).toBe(false);
    expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: 'a@sub.statuspage.io' }, rules)).toBe(false);
  });
  it('a site rule matches only a site item, and normalizes the host', () => {
    expect(matchesNotEmergencyRule({ kind: 'site', host: 'www.jillscafe.com' }, rules)).toBe(true);
    expect(matchesNotEmergencyRule({ kind: 'site', host: 'other.com' }, rules)).toBe(false);
    expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: 'x@jillscafe.com' }, rules)).toBe(false);
  });
  it('never matches a task, however the rules read', () => {
    expect(matchesNotEmergencyRule({ kind: 'task' }, rules)).toBe(false);
  });
});

describe('keys', () => {
  it('round-trips', () => {
    const k = ruleKey('sender', 'alerts@wpmudev.com');
    expect(k).toBe('home-not-emergency:sender:alerts@wpmudev.com');
    expect(parseRuleKey(k)).toEqual({ kind: 'sender', value: 'alerts@wpmudev.com' });
    expect(parseRuleKey('home-not-emergency:nope:x')).toBeNull();
    expect(parseRuleKey('other:sender:x')).toBeNull();
  });
  it('refuses a key that would not fit', () => {
    expect(ruleKey('domain', 'a'.repeat(RULE_KEY_MAX))).toBeNull();
  });
  it('normalizeHost', () => {
    expect(normalizeHost('HTTP://user@Example.com:8080/a?b')).toBe('example.com');
    expect(normalizeHost('localhost')).toBe('');
    expect(normalizeHost('')).toBe('');
  });
});
