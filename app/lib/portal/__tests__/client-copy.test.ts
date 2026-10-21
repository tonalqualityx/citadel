import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PROMISES } from '../intake/__tests__/promise-scan';
import {
  AWAITING_YOU_LABEL,
  REQUEST_LABELS,
  activityLabel,
  phaseStateLabel,
  projectStatusLabel,
  taskStatusLabel,
} from '../status-labels';
import { DEFAULT_PLAN_LABEL, engagementText } from '../engagement';

// Every string a client sees from slice 1 is scanned: the status labels, the engagement chips and
// the text in every new page and component. Money, dates, durations, "free", "guarantee" and
// em dashes fail. (The intake tree's own strings are scanned in intake-tree.test.ts.)
const APP = path.resolve(__dirname, '..', '..', '..');

// Strings that describe a window we show, not a promise about our work.
const ALLOWED_DURATIONS = ['Closed in the last 30 days', 'Visits, last 30 days'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return /\.tsx?$/.test(p) && !/\.d\.ts$/.test(p) ? [p] : [];
  });
}

// Everything a signed-in client reads: every component under components/portal and every page the
// redesign covers. The proposal, contract, MSA, addendum and onboarding pages carry real prices and
// dates by design (the document itself), so their pricing tables are checked for dashes only.
const PAGES = [
  'home', 'projects', 'projects/[id]', 'retainer', 'requests', 'requests/new', 'work/[id]', 'history', 'book',
  'articles/[id]', 'login', 'login/verify', 'select', 'task-approval/[token]',
].map((p) => path.join(APP, 'app/(portal)/portal', p, 'page.tsx'));

const LIB_FILES = ['headline.ts', 'history-group.ts'].map((f) => path.join(APP, 'lib/portal', f));

const FILES = [...walk(path.join(APP, 'components/portal')), ...LIB_FILES, ...PAGES];

/** One scan for a source file: the list of problems, empty when it is clean. */
export function copyProblems(src: string, allowed: string[] = [], file = 'x.tsx'): string[] {
  const out: string[] = [];
  if (/[—–]/.test(stripComments(src))) out.push('em or en dash');
  for (const s of clientStrings(src, file.endsWith('.tsx'))) {
    if (!ALLOWED_DURATIONS.includes(s) && !allowed.includes(s)) for (const [name, re] of PROMISES) if (re.test(s)) out.push(`${name} in "${s}"`);
    if (/\bbast\b|\bcitadel\b|\bclaude\b|needs-mike|portal-chat|kind:/i.test(s)) out.push(`staff or tooling name in "${s}"`);
  }
  return out;
}

const DOCUMENT_PAGES = ['proposal', 'contract', 'msa', 'addendum', 'onboard'].map((p) =>
  path.join(APP, 'app/(portal)/portal', p, '[token]/page.tsx'),
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** JSX text and capitalised string literals: the words a person reads. Class names are skipped. */
export function clientStrings(src: string, jsx = true): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  if (jsx) for (const m of code.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const text = m[2].replace(/\$\{[^}]*\}/g, 'x');
    if (/^[A-Z][^\n]*$/.test(text) && /[a-z]/.test(text) && !text.includes('/api/')) out.push(text);
  }
  return out
    .map((t) => t.replace(/&apos;|&#39;/g, "'").replace(/&middot;/g, '.').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 2 && /[A-Za-z]{2}/.test(t));
}

describe('the scanner itself', () => {
  it('fails on a known-bad string (the gate can go red)', () => {
    expect(copyProblems(`export const A = () => <p>Your site will be done by Friday</p>;`).join('|')).toMatch(/will be done/);
    expect(copyProblems(`const x = 'Updated in 2 days';`).join('|')).toMatch(/duration/);
    expect(copyProblems(`const y = 'Ready — see you soon';`).join('|')).toMatch(/dash/);
    expect(copyProblems(`export const B = () => <p>We will be in touch tomorrow</p>;`).join('|')).toMatch(/same-day or next-day/);
    expect(copyProblems(`export const B = () => <p>Hello there</p>;`)).toEqual([]);
  });
  it('finds JSX text and capitalised literals, skips class names and comments', () => {
    const found = clientStrings(`
      // A comment — with a dash
      export const X = () => <p className="text-sm font-medium">Hello there</p>;
      const label = 'Something went wrong';
      const cls = 'min-h-[44px] rounded-md';
    `);
    expect(found).toContain('Hello there');
    expect(found).toContain('Something went wrong');
    expect(found.join('|')).not.toMatch(/text-sm|rounded-md|comment/);
  });
  it('actually reads the files (a real number of strings)', () => {
    const total = FILES.flatMap((f) => clientStrings(readFileSync(f, 'utf8'))).length;
    expect(FILES.length).toBeGreaterThan(30);
    expect(total).toBeGreaterThan(150);
  });
});

describe('every client-facing string in the portal', () => {
  for (const file of FILES) {
    const rel = path.relative(APP, file);
    const src = readFileSync(file, 'utf8');
    it(`${rel}: no em or en dashes in code or text`, () => {
      expect(stripComments(src)).not.toMatch(/[—–]/);
    });
    it(`${rel}: no promises (money, dates, durations, free, guarantee)`, () => {
      for (const s of clientStrings(src, file.endsWith('.tsx'))) {
        if (ALLOWED_DURATIONS.includes(s)) continue;
        for (const [name, re] of PROMISES) expect(s, `${name} in "${s}"`).not.toMatch(re);
      }
    });
    it(`${rel}: never names staff or tooling`, () => {
      for (const s of clientStrings(src, file.endsWith('.tsx'))) expect(s, s).not.toMatch(/\bbast\b|\bcitadel\b|\bclaude\b|needs-mike|portal-chat|kind:/i);
    });
  }
});

describe('document pages', () => {
  // The five token pages carry real prices and dates as data, never as literals, so the same scan
  // (promises, dashes, staff names) applies to the words we wrote.
  for (const file of DOCUMENT_PAGES) {
    const rel = path.relative(APP, file);
    it(`${rel}: copy scan is clean`, () => {
      // "Price" is a table header of the document itself, not a promise.
      expect(copyProblems(readFileSync(file, 'utf8'), ['Price'])).toEqual([]);
    });
  }
});

describe('status labels and chips', () => {
  const labels = [
    ...Object.values(REQUEST_LABELS),
    AWAITING_YOU_LABEL,
    ...['ready', 'in_progress', 'review', 'done', 'x'].map(projectStatusLabel),
    ...['not_started', 'in_progress', 'blocked', 'review', 'done', 'abandoned', 'x'].map((s) => taskStatusLabel(s)),
    ...(['done', 'current', 'upcoming'] as const).map(phaseStateLabel),
    ...(['task_completed', 'task_approved', 'article_published'] as const).map(activityLabel),
    DEFAULT_PLAN_LABEL,
    engagementText({ kind: 'project', label: 'Relaunch', href: null }),
    engagementText({ kind: 'retainer', label: DEFAULT_PLAN_LABEL, href: null }),
    engagementText({ kind: 'request', label: 'example.com', href: null }),
  ];
  it('has no dashes and no promises', () => {
    for (const l of labels) {
      expect(l, l).not.toMatch(/[—–]/);
      for (const [name, re] of PROMISES) expect(l, `${name} in "${l}"`).not.toMatch(re);
    }
  });
});
