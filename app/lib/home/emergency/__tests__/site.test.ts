import { describe, it, expect } from 'vitest';
import {
  closeOnCheck,
  closeOnMailHandled,
  closeOnWatchdog,
  matchSiteHosts,
  parseSiteItemKey,
  siteDownItems,
  siteIncidentShown,
  siteItemKey,
  type IncidentRow,
  type SiteHost,
} from '../site';

const NOW = new Date('2026-11-11T15:00:00Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const sites: SiteHost[] = [
  { id: S1, host: 'jillscafe.com', client_id: 'c1', client_name: "Jill's Cafe" },
  { id: S2, host: 'wol.org', client_id: 'c2', client_name: 'Word of Life' },
  { id: '33333333-3333-4333-8333-333333333333', host: 'balloons.org', client_id: 'c3', client_name: 'Balloon Guild' },
];
const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  site_id: S1,
  domain: 'jillscafe.com',
  client_id: 'c1',
  client_name: "Jill's Cafe",
  source: 'kuma',
  ask_ids: [],
  started_at: min(35),
  last_checked_at: min(3),
  last_check_up: null,
  closed_at: null,
  ...over,
});

describe('matchSiteHosts', () => {
  it('finds a site named in the subject or gist, with or without www', () => {
    expect(matchSiteHosts('Uptime alert: www.JillsCafe.com is DOWN', sites).map((s) => s.id)).toEqual([S1]);
    expect(matchSiteHosts('jillscafe.com.', sites)).toHaveLength(1);
  });
  it('does not match a longer name, a subdomain or a lookalike', () => {
    expect(matchSiteHosts('jillscafe.com.au is down', sites)).toEqual([]);
    expect(matchSiteHosts('blog.jillscafe.com is down', sites)).toEqual([]);
    expect(matchSiteHosts('notjillscafe.com is down', sites)).toEqual([]);
    expect(matchSiteHosts('evil-jillscafe.com is down', sites)).toEqual([]);
  });
  it('leaves noise sites out (noise domain and noise client)', () => {
    expect(matchSiteHosts('wol.org is down. balloons.org is down.', sites)).toEqual([]);
  });
  it('only ever returns hosts from the list it was given', () => {
    expect(matchSiteHosts('attacker.example is down', sites)).toEqual([]);
    expect(matchSiteHosts(null, sites)).toEqual([]);
  });
});

describe('item keys', () => {
  it('builds and parses site keys', () => {
    expect(siteItemKey(S1)).toBe(`site:${S1}`);
    expect(parseSiteItemKey(`site:${S1}`)).toBe(S1);
    expect(parseSiteItemKey('site:nope')).toBeNull();
    expect(parseSiteItemKey('task:' + S1)).toBeNull();
  });
});

describe('what is shown', () => {
  it('a Kuma incident 5 minutes old is not shown and at 12 minutes it is', () => {
    expect(siteIncidentShown(row({ started_at: min(5) }), NOW)).toBe(false);
    expect(siteIncidentShown(row({ started_at: min(12) }), NOW)).toBe(true);
    expect(siteIncidentShown(row({ started_at: min(10) }), NOW)).toBe(true);
  });
  it('a mail incident shows only after Bast found the site down', () => {
    expect(siteIncidentShown(row({ source: 'uptime_mail', last_check_up: null }), NOW)).toBe(false);
    expect(siteIncidentShown(row({ source: 'uptime_mail', last_check_up: true }), NOW)).toBe(false);
    expect(siteIncidentShown(row({ source: 'uptime_mail', last_check_up: false }), NOW)).toBe(true);
  });
  it('a closed incident is never shown', () => {
    expect(siteIncidentShown(row({ closed_at: min(1) }), NOW)).toBe(false);
  });
});

describe('siteDownItems', () => {
  it('words the row and the second line', () => {
    const [i] = siteDownItems([row()], NOW);
    expect(i.key).toBe(`site:${S1}`);
    expect(i.title).toBe('jillscafe.com is down.');
    expect(i.detail).toBe("Jill's Cafe · down 35 minutes · checked again 3 minutes ago");
    expect(i.default_if_ignored).toContain('watchdog already told you on Slack');
  });
  it('one item per site, longest down first, and the mail is linked', () => {
    const items = siteDownItems(
      [
        row({ site_id: S2, domain: 'b.com', started_at: min(20) }),
        row({ started_at: min(40) }),
        row({ started_at: min(60), source: 'uptime_mail', last_check_up: false, ask_ids: ['a1'] }),
      ],
      NOW
    );
    expect(items.map((i) => i.domain)).toEqual(['jillscafe.com', 'b.com']);
    expect(items[0].source).toBe('uptime_mail');
    expect(items[0].ask_ids).toEqual(['a1']);
  });
});

describe('close rules', () => {
  it('an up check closes a mail incident as answered, never a Kuma one', () => {
    expect(closeOnCheck({ source: 'uptime_mail', closed_at: null }, true)).toEqual({ close: true, reason: 'answered' });
    expect(closeOnCheck({ source: 'uptime_mail', closed_at: null }, false)).toEqual({ close: false });
    expect(closeOnCheck({ source: 'kuma', closed_at: null }, true)).toEqual({ close: false });
  });
  it('a watchdog list that could not be read closes nothing', () => {
    expect(closeOnWatchdog([row()], null)).toEqual([]);
  });
  it('a watchdog list closes the Kuma incidents it no longer holds', () => {
    expect(closeOnWatchdog([row(), row({ site_id: S2 })], new Set([S2]))).toEqual([S1]);
    expect(closeOnWatchdog([row({ source: 'uptime_mail' })], new Set())).toEqual([]);
  });
  it('a mail incident with no open mail left closes as mail_handled', () => {
    expect(closeOnMailHandled({ source: 'uptime_mail', closed_at: null }, 0)).toEqual({ close: true, reason: 'mail_handled' });
    expect(closeOnMailHandled({ source: 'uptime_mail', closed_at: null }, 1)).toEqual({ close: false });
  });
});
