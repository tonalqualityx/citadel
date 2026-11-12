// @vitest-environment node
/**
 * Work stage F invariant: no client-facing surface can read the two clocks. Same grep style as ask-closure-callers.test.ts.
 *   1. Every file on a client-facing surface (the portal, client reports, retainer reports and billing, Steward) neither imports the
 *      clock lib, nor the clock hook or component, nor names the work_clock table or its Prisma model.
 *   2. The set of files that DO touch the clocks is exactly the list below, so a new reader fails here until it is named (and judged).
 *      (The small shared files that only carry the log_clock body, record type or request type name no table or lib, so they are not listed.)
 * Time that reaches a client is only ever a TimeEntry the owner logged with his own tap (log_clock); that entry is the existing
 * billable record and is not what this test guards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', 'e2e']);

/** Anything that reads or writes the clocks: the lib, its words, its hook and component, the table and the model. */
const CLOCK_REF = /work_clock|\bworkClock\b|\bWorkClock\b|lib\/work\/clocks|\.\/clocks['"]|clocks-copy|use-work-clocks|WorkClockLines|\/api\/work\/[^'"`]*\/clocks|\/api\/oracle\/clocks/;

/** The only non-test files that may touch the clocks. */
const ALLOWED = [
  'app/api/oracle/clocks/route.ts', // the machine posts rows
  'app/api/work/[key]/clocks/route.ts', // the owner's session reads his two lines
  'app/api/home/reconcile/route.ts', // his Log it tap
  'components/domain/home/HomeProjectDrawer.tsx', // the owner's project drawer
  'components/domain/home/ItemCard.tsx', // the owner's task card
  'components/domain/home/WorkClockLines.tsx',
  'lib/auth/lane-scopes.ts', // the route entry of the oracle and bast-chat lanes
  'lib/hooks/use-work-clocks.ts',
  'lib/home/reconcile/undo.ts', // Undo of a Log it
  'lib/work/clocks.ts',
  'lib/work/session-track.ts', // Track it stores the time already spent as one estimate row
];

/** Path words that mark a client-facing surface (directory or file names), plus the named billing and retainer files. */
const SURFACE_PATH = /(^|\/)(portal|portal-chat|portal-notices|portal-view-as|client-reports|reports|retainers?|steward|invoices?|billing|scheduled-invoices|\(portal\))(\/|\.|$)/i;
const NAMED_SURFACE = ['lib/calculations/retainer.ts', 'lib/calculations/billing.ts', 'lib/calculations/invoices.ts', 'app/api/clients/[id]/retainer/route.ts', 'app/api/clients/[id]/invoices/route.ts', 'lib/api/registry/portal.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const all = ['app', 'lib', 'components'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const isTest = (r: string) => /\.test\./.test(r) || r.includes('/__tests__/');
const src = all.filter((f) => !isTest(rel(f)));

describe('no client-facing surface reads the two clocks', () => {
  it('the scan tells a clock reference from everything else', () => {
    for (const hit of ["import { loadClockSummary } from '@/lib/work/clocks';", 'prisma.workClock.findMany({})', 'SELECT * FROM work_clock', "fetch('/api/work/task:1/clocks')", "from '@/lib/hooks/use-work-clocks'"]) {
      expect(CLOCK_REF.test(hit), hit).toBe(true);
    }
    for (const miss of ["import { retainerStatus } from '@/lib/calculations/retainer';", 'prisma.timeEntry.findMany({})', "import { x } from '@/lib/work/state';"]) {
      expect(CLOCK_REF.test(miss), miss).toBe(false);
    }
    expect(SURFACE_PATH.test('lib/portal/retainer.ts')).toBe(true);
    expect(SURFACE_PATH.test('lib/work/clocks.ts')).toBe(false);
  });

  it('the surface scan finds the portal, client reports, retainer and billing code (so the guard is not empty)', () => {
    const surface = src.map(rel).filter((r) => SURFACE_PATH.test(r) || NAMED_SURFACE.includes(r));
    expect(surface.length).toBeGreaterThan(20);
    for (const must of ['lib/portal/retainer.ts', 'app/api/client-reports/route.ts', 'lib/calculations/retainer.ts', 'app/api/clients/[id]/retainer/route.ts']) {
      expect(surface, must).toContain(must);
    }
    expect(surface.some((r) => r.startsWith('app/api/portal/'))).toBe(true);
    expect(surface.some((r) => r.startsWith('components/portal/'))).toBe(true);
  });

  it('no file on a client-facing surface names the clock table, its model, its lib, its hook or its routes', () => {
    const offenders = src
      .map(rel)
      .filter((r) => SURFACE_PATH.test(r) || NAMED_SURFACE.includes(r))
      .filter((r) => CLOCK_REF.test(fs.readFileSync(path.join(ROOT, r), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('any file that mentions Steward or a client report is also free of the clocks', () => {
    const offenders = src
      .map(rel)
      .filter((r) => !ALLOWED.includes(r))
      .filter((r) => {
        const t = fs.readFileSync(path.join(ROOT, r), 'utf8');
        return /steward|client-reports|retainer/i.test(t) && CLOCK_REF.test(t);
      });
    expect(offenders).toEqual([]);
  });

  it('only the listed files touch the clocks (a new reader must be named here and judged)', () => {
    const touching = src.map(rel).filter((r) => CLOCK_REF.test(fs.readFileSync(path.join(ROOT, r), 'utf8'))).sort();
    expect(touching).toEqual([...ALLOWED].sort());
  });

  it('none of the allowed files is on a client-facing surface', () => {
    const bad = ALLOWED.filter((r) => (SURFACE_PATH.test(r) || NAMED_SURFACE.includes(r)) && r !== 'app/api/home/reconcile/route.ts');
    expect(bad).toEqual([]);
  });

  it('the clock model is queried only by the clock lib, Track it (its estimate row) and the Log it undo', () => {
    // the TimeEntry rows a Log it makes are the existing billable record; the clock model itself is not selected anywhere else
    const hits = src.map(rel).filter((r) => /\bworkClock\./.test(fs.readFileSync(path.join(ROOT, r), 'utf8'))).sort();
    expect(hits).toEqual(['lib/home/reconcile/undo.ts', 'lib/work/clocks.ts', 'lib/work/session-track.ts']);
  });
});
