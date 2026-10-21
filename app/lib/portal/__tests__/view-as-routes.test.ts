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
const ROOTS = ['app/api/portal', 'app/api/portal-chat'].map((r) => path.join(APP, r));
const WRITE = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

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

function writeRoutes(): WriteRoute[] {
  const out: WriteRoute[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      // A re-export or an unusual declaration could hide a write handler from this scan: fail loudly.
      expect(source, `${file} uses an export form this test cannot scan`).not.toMatch(/export\s*\{[^}]*\b(POST|PATCH|PUT|DELETE)\b/);
      expect(source, `${file} declares a write handler as a const`).not.toMatch(/export\s+const\s+(POST|PATCH|PUT|DELETE)\b/);
      for (const method of WRITE) {
        if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source)) {
          out.push({ file, rel: path.relative(APP, file), method, source });
        }
      }
    }
  }
  return out;
}

const ROUTES = writeRoutes();

function sampleParams(): Promise<Record<string, string>> {
  return Promise.resolve({ id: '00000000-0000-4000-8000-000000000001', token: 'tok', clientId: '00000000-0000-4000-8000-000000000002' });
}

describe('view-as: every write route refuses a view-as session', () => {
  beforeEach(() => {
    lookups.length = 0;
  });

  it('finds the write routes on disk (guards against an empty scan)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(28);
    expect(ROUTES.some((r) => r.rel.includes('portal/tasks/mine/[id]/approve'))).toBe(true);
    expect(ROUTES.some((r) => r.rel.includes('portal-chat/settings'))).toBe(true);
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
