import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PROMISES } from '../intake/__tests__/promise-scan';
import { buildNoticeBody, noticeSubject } from '../notices';
import { MESSAGE_RATE_LIMIT_MESSAGE, STAFF_AUTHOR_NAME } from '../thread';

// Portal phase B slice 2: the promise and dash scan, extended to the new client-facing copy.
// The thread, retainer and projects pages, the notice email and the limit message may not promise
// money, dates, durations, "free", "included" or a guarantee, and may not use em or en dashes.
// One sentence is fixed by the spec and exempt from the promise scan: the plan allowance
// ("Your plan includes up to {n} hours ..."), which states the plan, not a promise.

const APP = path.resolve(__dirname, '..', '..', '..');
const FILES = [
  'components/portal/thread.tsx',
  'app/(portal)/portal/retainer/page.tsx',
  'app/(portal)/portal/projects/page.tsx',
  'app/(portal)/portal/projects/[id]/page.tsx',
  'components/portal/retainer-card.tsx',
  'components/portal/plan-approval-block.tsx',
  'components/portal/report-link.tsx',
  'lib/portal/retainer.ts',
  'lib/portal/thread.ts',
  'lib/portal/notices.ts',
];
const ALLOWANCE = /Your plan (includes|covers) up to/;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

function looksLikeCopy(s: string): boolean {
  if (!/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(s)) return false;
  const tokens = s.split(/\s+/);
  const codey = tokens.filter((t) => /[-[\]:/_.=]/.test(t) && !/^[A-Za-z]+[.,;:!?]?$/.test(t)).length;
  return codey / tokens.length < 0.5;
}

export function clientStrings(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/g)) out.push(m[2]);
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out.filter(looksLikeCopy);
}

describe('thread, retainer and projects copy', () => {
  const strings = FILES.flatMap((f) => clientStrings(fs.readFileSync(path.join(APP, f), 'utf8')).map((s) => `${f}: ${s}`));

  it('actually finds the copy (the scan is not vacuous)', () => {
    const all = strings.join('\n');
    for (const known of [
      'Your message goes to the team working on this.',
      'No messages yet. Add details, links or questions here and the team will see them on this request.',
      'When you have one, your monthly plan, reports and the work in progress show here.',
      'Read it, then approve it or book a call to talk it through. Approving here or by email both count.',
      'When we build something for you, its progress, approvals and history show here.',
    ]) {
      expect(all, known).toContain(known);
    }
    expect(strings.length).toBeGreaterThan(15);
  });

  it('has no em dashes or en dashes', () => {
    for (const s of strings) expect(s, s).not.toMatch(/[—–]/);
  });

  it('promises no money, date, duration, "free", "included" or "guarantee"', () => {
    for (const s of strings) {
      if (ALLOWANCE.test(s)) continue;
      const scan = s.replace(/\$\{[^}]*\}/g, '');
      for (const [name, re] of PROMISES) expect(scan, `${name}: ${s}`).not.toMatch(re);
    }
  });

  it('the scan catches what it should', () => {
    expect(PROMISES.some(([, re]) => re.test('We will reply within 2 days'))).toBe(true);
    expect(clientStrings('<p>Nothing here — at all</p>').some((s) => /—/.test(s))).toBe(true);
  });
});

describe('server-written client text', () => {
  it('the rate limit message and the staff author label', () => {
    expect(MESSAGE_RATE_LIMIT_MESSAGE).not.toMatch(/[—–]/);
    expect(STAFF_AUTHOR_NAME).toBe('Indelible');
  });
  it('the notice subject and the fixed email text', () => {
    const body = buildNoticeBody({ noticeId: 'abcdefgh-1', taskId: 't', contactName: 'Dana', clientTitle: 'Request', replies: ['Reply.'] });
    for (const s of [noticeSubject('Request'), body]) {
      expect(s).not.toMatch(/[—–]/);
      expect(s).not.toMatch(/\bbast\b/i);
    }
  });
});
