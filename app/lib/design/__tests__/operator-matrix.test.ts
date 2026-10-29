/**
 * The H7 regression matrix with operator keys (Mike, 2026-10-29). Every non-worker /api/design handler on disk is
 * called with an API key of each kind; the route header is what proxy.ts would stamp. A handler admits the key only
 * when the key carries the scope AND the route is on that scope's list in lib/design/operator.ts; every other
 * combination answers exactly what H7 answered: 403 session_required. A new design route therefore starts closed to
 * keys, and the test fails if a route opts in without being on the allowlist (or the reverse).
 *
 * The data layer is a stub (every read is empty), so an admitted call ends in 200/400/404/409/500 from the handler's
 * own logic; only the auth outcome is asserted here. The real path runs in operator.integration.test.ts.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  routeHeader: null as string | null,
  key: null as null | { id: string; user_id: string; is_revoked: boolean; scopes: string[] },
  dbRole: 'admin' as string,
}));

vi.mock('@/lib/auth/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.routeHeader ? { 'x-citadel-route': state.routeHeader } : {}),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const answer = (model: string, method: string, args: { where?: { id?: string } } | undefined) => {
    if (model === 'apiKey' && method === 'findUnique') return state.key && args?.where?.id === state.key.id ? state.key : null;
    if (model === 'user' && (method === 'findUnique' || method === 'findFirst')) {
      return args?.where?.id ? { id: args.where.id, role: state.dbRole, is_active: true, name: 'Op' } : null;
    }
    if (method === 'findMany' || method === 'groupBy') return [];
    if (method === 'count') return 0;
    if (method === 'updateMany' || method === 'deleteMany') return { count: 0 };
    return null;
  };
  const model = (name: string) => new Proxy({}, { get: (_t, m) => async (args: never) => answer(name, String(m), args) });
  const prisma = new Proxy({}, {
    get: (_t, name) => {
      if (name === '$transaction') return async () => { throw new Error('no transactions in the matrix'); };
      if (name === '$queryRaw' || name === '$executeRaw') return async () => [];
      if (typeof name !== 'string' || name === 'then') return undefined;
      return model(name);
    },
  });
  return { prisma, default: prisma };
});

import { requireAuth } from '@/lib/auth/middleware';
import { DESIGN_OPERATOR_ROUTES, operatorRouteAllowed, type OperatorKind } from '../operator';

const UUID = 'c0ffee00-0000-4000-8000-000000000001';
const USER = 'c0ffee00-0000-4000-8000-0000000000aa';
const KEY_ID = 'c0ffee00-0000-4000-8000-0000000000bb';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const DESIGN_DIR = path.resolve(__dirname, '../../../app/api/design');

interface Handler {
  method: string;
  urlPath: string;
  fn: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  params: Record<string, string>;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'worker') continue;
      out.push(...routeFiles(p));
    } else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const handlers: Handler[] = [];

beforeAll(async () => {
  for (const file of routeFiles(DESIGN_DIR)) {
    const rel = path.relative(path.resolve(DESIGN_DIR, '../../..'), path.dirname(file)); // app/api/design/...
    const segments = rel.split(path.sep).slice(1); // drop the leading "app"
    const params: Record<string, string> = {};
    const urlPath = '/' + segments.map((s) => {
      const m = /^\[(.+)\]$/.exec(s);
      if (!m) return s;
      params[m[1]] = UUID;
      return UUID;
    }).join('/');
    const mod = (await import(file)) as Record<string, unknown>;
    for (const method of METHODS) {
      if (typeof mod[method] === 'function') handlers.push({ method, urlPath, fn: mod[method] as Handler['fn'], params });
    }
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function arrange(opts: { scopes: string[]; lane?: string; revoked?: boolean; owner?: string; dbRole?: string; noRouteHeader?: boolean }, h: Handler) {
  vi.mocked(requireAuth).mockResolvedValue({
    userId: USER, email: 'mike@example.test', role: 'admin', via: 'api_key', apiKeyId: KEY_ID,
    ...(opts.lane ? { lane: opts.lane, laneEnforced: true } : {}),
  } as never);
  state.key = { id: KEY_ID, user_id: opts.owner ?? USER, is_revoked: !!opts.revoked, scopes: opts.scopes };
  state.dbRole = opts.dbRole ?? 'admin';
  state.routeHeader = opts.noRouteHeader ? null : `${h.method} ${h.urlPath}`;
}

async function call(h: Handler): Promise<{ status: number; code?: string }> {
  const req = new NextRequest(`http://localhost${h.urlPath}`, {
    method: h.method,
    headers: { 'content-type': 'application/json' },
    ...(h.method === 'GET' || h.method === 'DELETE' ? {} : { body: '{}' }),
  });
  const res = await h.fn(req, { params: Promise.resolve(h.params) });
  let code: string | undefined;
  try { code = (await res.json())?.code; } catch { /* non-JSON body */ }
  return { status: res.status, code };
}

const refused = (r: { status: number; code?: string }) => r.status === 403 && r.code === 'session_required';
const label = (h: Handler) => `${h.method} ${h.urlPath}`;

describe('operator keys on every non-worker design handler', () => {
  it('found the design surface (sanity)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(30);
    expect(handlers.map(label)).toContain(`POST /api/design/sessions/${UUID}/messages`);
  });

  it('every allowlisted route exists on disk (the list names real handlers)', () => {
    for (const kind of ['setup', 'publish'] as const) {
      for (const r of DESIGN_OPERATOR_ROUTES[kind]) {
        expect(handlers.some((h) => h.method === r.method && operatorRouteAllowed(kind, h.method, h.urlPath)), `${kind} ${r.method} ${r.pattern}`).toBe(true);
      }
    }
  });

  it('H7 stays fixed: an admin key WITHOUT the scopes is 403 session_required everywhere', async () => {
    for (const h of handlers) {
      arrange({ scopes: [] }, h);
      expect(refused(await call(h)), label(h)).toBe(true);
      arrange({ scopes: ['decisions:admin', 'engine'] }, h);
      expect(refused(await call(h)), label(h)).toBe(true);
    }
  });

  for (const kind of ['setup', 'publish'] as OperatorKind[]) {
    it(`design:operator-${kind}: admitted exactly on its list, 403 session_required everywhere else`, async () => {
      const admitted: string[] = [];
      for (const h of handlers) {
        arrange({ scopes: [`design:operator-${kind}`] }, h);
        const r = await call(h);
        if (operatorRouteAllowed(kind, h.method, h.urlPath)) {
          expect(refused(r), `${label(h)} should admit the ${kind} key (got ${r.status} ${r.code})`).toBe(false);
          expect(r.status, label(h)).not.toBe(401);
          admitted.push(label(h));
        } else {
          expect(refused(r), `${label(h)} must refuse the ${kind} key (got ${r.status} ${r.code})`).toBe(true);
        }
      }
      expect(admitted.length).toBe(DESIGN_OPERATOR_ROUTES[kind].length);
    });
  }

  it('designer write routes refuse a key holding BOTH scopes (messages, apply, pins, stop, budget, close, restore, request-publish, changes, sessions POST)', async () => {
    const writes = handlers.filter((h) => h.method !== 'GET' && !operatorRouteAllowed('setup', h.method, h.urlPath) && !operatorRouteAllowed('publish', h.method, h.urlPath));
    expect(writes.map(label)).toEqual(expect.arrayContaining([
      `POST /api/design/sessions/${UUID}/messages`, `POST /api/design/sessions/${UUID}/apply`, `POST /api/design/sessions/${UUID}/pins`,
      `PATCH /api/design/pins/${UUID}`, `POST /api/design/sessions/${UUID}/request-publish`, `POST /api/design/sessions/${UUID}/budget`,
      `POST /api/design/sessions`,
    ]));
    for (const h of writes) {
      arrange({ scopes: ['design:operator-setup', 'design:operator-publish'] }, h);
      expect(refused(await call(h)), label(h)).toBe(true);
    }
  });

  const both = ['design:operator-setup', 'design:operator-publish'];
  const cases: Array<[string, Parameters<typeof arrange>[0]]> = [
    ['a lane key (design-worker, even with the scopes planted)', { scopes: ['lane:design-worker', 'scope-mode:enforce', ...both], lane: 'design-worker' }],
    ['a planted lane scope on the key row', { scopes: ['lane:bast', ...both] }],
    ['a revoked key', { scopes: both, revoked: true }],
    ['a key that belongs to someone else', { scopes: both, owner: 'c0ffee00-0000-4000-8000-0000000000cc' }],
    ['an owner whose DATABASE role is pm', { scopes: both, dbRole: 'pm' }],
    ['an owner whose DATABASE role is designer', { scopes: both, dbRole: 'designer' }],
    ['no proxy route header', { scopes: both, noRouteHeader: true }],
  ];
  for (const [name, opts] of cases) {
    it(`${name}: 403 session_required on every handler`, async () => {
      for (const h of handlers) {
        arrange(opts, h);
        expect(refused(await call(h)), label(h)).toBe(true);
      }
    });
  }

  it('a route header for another (allowlisted) route does not open this one', async () => {
    const messages = handlers.find((h) => h.method === 'POST' && h.urlPath.endsWith('/messages'))!;
    arrange({ scopes: both }, messages);
    state.routeHeader = `POST /api/design/sessions/${UUID}/publish`; // what a forged header would claim (proxy.ts overwrites it anyway)
    // The handler itself did not opt in, so the header is never even read: still the H7 answer.
    expect(refused(await call(messages))).toBe(true);
  });
});
