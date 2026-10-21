import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { VIEW_AS_READ_ONLY_LINE } from '../view-as-copy';

// The read-only promise of "View as client": EVERY write route (POST, PATCH, PUT, DELETE) under
// app/api/portal and app/api/portal-chat refuses an admin's view-as session with 403 before it does
// anything else. The list of routes is derived from the filesystem, so a new write route added
// without the guard fails here.

const APP = path.resolve(__dirname, '..', '..', '..');
const API = path.join(APP, 'app/api');
const TREES = ['app/api/portal', 'app/api/portal-chat'].map((r) => path.join(APP, r));
const WRITE = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;
const SESSION_SYMBOLS = /requireClientAuth|validateClientSession|CLIENT_SESSION_COOKIE/;

// Staff-only routes under /api/portal-chat: they check a Citadel staff login (requireAuth + requireRole),
// never the portal cookie, so a view-as session means nothing to them and they are not guarded.
const STAFF_ONLY = [
  'app/api/portal-chat/settings/route.ts',
  'app/api/portal-chat/sweep/route.ts',
  'app/api/portal-chat/inbound/route.ts',
  'app/api/portal-chat/inbound/attachments/route.ts',
];
// The two routes that mint or end a view. They handle the portal cookie on purpose and must stay reachable
// from a view (exit) or run from the admin side (start); both have their own tests in view-as.test.ts.
const COOKIE_HANDLERS = ['app/api/clients/[id]/view-as/route.ts', 'app/api/portal-view-as/exit/route.ts'];

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (name === 'client_session' ? { value: 'view-as-token' } : undefined) })),
  headers: vi.fn(async () => new Headers()),
}));

const lookups: Array<{ model: string; fn: string }> = [];
vi.mock('@/lib/db/prisma', () => {
  // Only the view-as guard's own lookup may touch the database. Anything else means the route did
  // work before refusing, which the test below reports.
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, fn: string) => async () => {
              lookups.push({ model, fn });
              if (model === 'portalSession' && fn === 'findFirst') return { id: 'view-as-row' };
              throw new Error(`prisma.${model}.${fn} was reached before the view-as refusal`);
            },
          }
        ),
    }
  );
  return { prisma, default: prisma };
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return f === 'route.ts' ? [p] : [];
  });
}

interface WriteRoute {
  file: string;
  rel: string;
  method: (typeof WRITE)[number];
  source: string;
}

function declaredWriteMethods(source: string): Array<(typeof WRITE)[number]> {
  // A re-export or an unusual declaration could hide a write handler from this scan: fail loudly.
  expect(source).not.toMatch(/export\s*\{[^}]*\b(POST|PATCH|PUT|DELETE)\b/);
  expect(source).not.toMatch(/export\s+const\s+(POST|PATCH|PUT|DELETE)\b/);
  return WRITE.filter((m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(source));
}

/** Every route that must refuse a view-as session: all write routes in the two portal trees, plus any other
 *  app/api route that reads the portal session, minus the staff-only and cookie-handling allowlists. */
function writeRoutes(): { routes: WriteRoute[]; scanned: string[] } {
  const out: WriteRoute[] = [];
  const treeFiles = TREES.flatMap(walk);
  const sessionFiles = walk(API).filter((f) => SESSION_SYMBOLS.test(readFileSync(f, 'utf8')));
  const scanned = [...new Set([...treeFiles, ...sessionFiles])];
  for (const file of scanned) {
    const rel = path.relative(APP, file);
    if (STAFF_ONLY.includes(rel) || COOKIE_HANDLERS.includes(rel)) continue;
    const source = readFileSync(file, 'utf8');
    for (const method of declaredWriteMethods(source)) out.push({ file, rel, method, source });
  }
  return { routes: out, scanned };
}

const { routes: ROUTES, scanned: SCANNED } = writeRoutes();

function sampleParams(): Promise<Record<string, string>> {
  return Promise.resolve({ id: '00000000-0000-4000-8000-000000000001', token: 'tok', clientId: '00000000-0000-4000-8000-000000000002' });
}

describe('view-as: every write route refuses a view-as session', () => {
  beforeEach(() => {
    lookups.length = 0;
  });

  it('the staff-only and cookie-handling allowlists are real routes that behave as described', () => {
    for (const rel of STAFF_ONLY) {
      const src = readFileSync(path.join(APP, rel), 'utf8');
      expect(src, `${rel} must check a staff login`).toMatch(/requireAuth\(/);
      expect(src, `${rel} reads the portal session, so it is not staff-only`).not.toMatch(SESSION_SYMBOLS);
      expect(src, `${rel} is allowlisted, so it must not carry the guard`).not.toContain('refuseIfViewAs');
    }
    for (const rel of COOKIE_HANDLERS) expect(readFileSync(path.join(APP, rel), 'utf8')).toMatch(/CLIENT_SESSION_COOKIE/);
  });

  it('scans every route that reads the portal session, wherever it lives', () => {
    for (const rel of COOKIE_HANDLERS) expect(SCANNED.map((f) => path.relative(APP, f))).toContain(rel);
    expect(SCANNED.length).toBeGreaterThan(40);
  });

  it('finds the write routes on disk (guards against an empty scan)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(24);
    expect(ROUTES.some((r) => r.rel.includes('portal/tasks/mine/[id]/approve'))).toBe(true);
    expect(ROUTES.some((r) => r.rel.includes('portal-chat'))).toBe(false);
  });

  it.each(ROUTES.map((r) => [`${r.method} ${r.rel}`, r] as const))('%s calls refuseIfViewAs() as its first statement', (_name, route) => {
    const re = new RegExp(
      `export\\s+async\\s+function\\s+${route.method}\\b[\\s\\S]*?\\)\\s*(?::\\s*Promise<[^{]*?>\\s*)?\\{\\s*\\n\\s*const viewAsRefusal = await refuseIfViewAs\\(\\);\\s*\\n\\s*if \\(viewAsRefusal\\) return viewAsRefusal;`
    );
    expect(route.source).toMatch(re);
    expect(route.source).toContain("from '@/lib/portal/view-as-guard'");
  });

  it.each(ROUTES.map((r) => [`${r.method} ${r.rel}`, r] as const))('%s answers 403 with the read-only line and does no other work', async (_name, route) => {
    const mod = (await import(/* @vite-ignore */ route.file)) as Record<string, (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
    const req = new NextRequest(`http://localhost:3000/${route.rel}`, {
      method: route.method,
      headers: { 'Content-Type': 'application/json', Cookie: 'client_session=view-as-token' },
      body: route.method === 'DELETE' ? undefined : '{}',
    });
    const res = await mod[route.method](req, { params: sampleParams() });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(VIEW_AS_READ_ONLY_LINE);
    expect(body.code).toBe('view_as_read_only');
    // The only database call is the guard's own lookup.
    expect(lookups).toEqual([{ model: 'portalSession', fn: 'findFirst' }]);
  });
});
