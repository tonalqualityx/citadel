import { describe, it, expect } from 'vitest';
import {
  MAX_SCANS_PER_RUN,
  SCAN_REPEAT_MS,
  neutraliseSummary,
  outsideCheckHandledLine,
  outsideCheckLine,
  scanBodySchema,
  scanSummaryProblem,
  selectScans,
  type ScanCandidate,
} from '../scan';
import type { SiteHost } from '../site';

const NOW = new Date('2026-11-11T15:00:00Z');
const site = (id: string, host: string, client_name: string | null = 'Jill'): SiteHost => ({ id, host, client_id: 'c', client_name });
const sites = new Map([
  ['s1', site('s1', 'jillscafe.com')],
  ['s2', site('s2', 'acme.example')],
  ['s3', site('s3', 'third.example')],
  ['s4', site('s4', 'wol.org')], // a noise domain
  ['s5', site('s5', 'noisy.example', 'Balloon Guild')], // a noise client
]);
const cand = (key: string, site_id: string, reason: ScanCandidate['reason'], mins: number): ScanCandidate => ({
  key,
  site_id,
  reason,
  since: new Date(NOW.getTime() - mins * 60_000),
});

describe('selectScans', () => {
  it('hands out at most two, a site that answers again before a security task, oldest first, host from the Site record', () => {
    const out = selectScans({
      candidates: [cand('task:a', 's1', 'security_task', 500), cand('site:s2', 's2', 'answers_again', 5), cand('site:s3', 's3', 'answers_again', 9)],
      sites,
      lastRequested: new Map(),
      now: NOW,
    });
    expect(out).toEqual([
      { key: 'site:s3', site_id: 's3', host: 'third.example' },
      { key: 'site:s2', site_id: 's2', host: 'acme.example' },
    ]);
    expect(out.length).toBeLessThanOrEqual(MAX_SCANS_PER_RUN);
  });

  it('one scan per site, whatever the number of reasons', () => {
    const out = selectScans({ candidates: [cand('site:s1', 's1', 'answers_again', 5), cand('task:a', 's1', 'security_task', 50)], sites, lastRequested: new Map(), now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('site:s1');
  });

  it('never a site scanned in the last 6 hours, and again after', () => {
    const c = [cand('site:s1', 's1', 'answers_again', 5)];
    expect(selectScans({ candidates: c, sites, lastRequested: new Map([['s1', new Date(NOW.getTime() - SCAN_REPEAT_MS + 60_000)]]), now: NOW })).toEqual([]);
    expect(selectScans({ candidates: c, sites, lastRequested: new Map([['s1', new Date(NOW.getTime() - SCAN_REPEAT_MS - 60_000)]]), now: NOW })).toHaveLength(1);
  });

  it('never a site that is not in the active list, a noise domain, or an unusable host', () => {
    const odd = new Map(sites).set('s6', site('s6', 'bad host.example')).set('s7', site('s7', 'a.b/c'));
    const c = [cand('site:x', 'missing', 'answers_again', 5), cand('site:s4', 's4', 'answers_again', 5), cand('site:s5', 's5', 'answers_again', 5), cand('site:s6', 's6', 'answers_again', 5), cand('site:s7', 's7', 'answers_again', 5)];
    expect(selectScans({ candidates: c, sites: odd, lastRequested: new Map(), now: NOW })).toEqual([]);
  });
});

describe('scanSummaryProblem', () => {
  const dash = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  it('passes the two example lines', () => {
    expect(scanSummaryProblem('the home page answers. 2 links to outside sites are new since the last check: ki-system.org, other.example.')).toBeNull();
    expect(scanSummaryProblem('nothing new found from outside.')).toBeNull();
  });
  it('refuses empty, long, multi-line, dash, banned words and links', () => {
    for (const s of ['  ', 'x'.repeat(501), 'a\nb', 'a b', `a ${dash} b`, `a ${en} b`, 'Priority one', 'two priorities', 'Overdue', 'https://a.com', 'http://a.com/x', 'a.com/login', 'a.com?x=1', 'mailto:a@b.com', '//a.com']) {
      expect(scanSummaryProblem(s), s).not.toBeNull();
    }
  });
  it('allows a plain hyphen and a hostname with a port-less dot', () => {
    expect(scanSummaryProblem('ki-system.org is new')).toBeNull();
  });
});

describe('neutraliseSummary', () => {
  it('drops markup, defuses mentions and links, squashes spaces', () => {
    expect(neutraliseSummary('a *bold* _x_ `c` <!channel> @here & more  |  [x] {y}')).toBe('a bold x c !channel at here and more x y');
  });
});

describe('scanBodySchema', () => {
  const good = { key: 'site:abc', summary: 'ok', findings: { a: 1 } };
  it('is strict', () => {
    expect(scanBodySchema.safeParse(good).success).toBe(true);
    expect(scanBodySchema.safeParse({ ...good, x: 1 }).success).toBe(false);
    expect(scanBodySchema.safeParse({ ...good, findings: [] }).success).toBe(false);
    expect(scanBodySchema.safeParse({ ...good, findings: { big: 'y'.repeat(8200) } }).success).toBe(false);
    expect(scanBodySchema.safeParse({ ...good, findings: { big: 'y'.repeat(8000) } }).success).toBe(true);
  });
});

describe('result lines', () => {
  it('shows his wall clock', () => {
    const at = new Date('2026-11-11T15:42:00Z');
    expect(outsideCheckLine('nothing new found from outside.', at, 'America/New_York')).toBe('Outside check 10:42: nothing new found from outside.');
    expect(outsideCheckHandledLine('jillscafe.com', 'ok.', at, 'America/New_York')).toBe('Outside check of jillscafe.com 10:42: ok.');
  });
});
