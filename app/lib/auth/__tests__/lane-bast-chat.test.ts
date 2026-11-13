import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { createHash } from 'node:crypto';

// Bast chat lane (implementation/plans/bast-chat.md 2.1 and 3 T3): always enforced, an exact route list, and
// nothing gained by any other lane. Checked in authenticateApiKey against x-citadel-route.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/auth/jwt', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
    apiKeyViolation: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '../middleware';
import { resetKeyViolationThrottle } from '../key-violations';
import { keyScopesSchema } from '../key-scopes';
import { ALWAYS_ENFORCED_LANES, LANES, LANE_IDENTITY, LANE_ROUTES, laneAllows } from '../lane-scopes';

const findKey = prisma.apiKey.findFirst as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const BAST_USER = { id: 'ca5335e7-0000-4000-8000-000000000001', email: 'bast@becomeindelible.com', role: 'pm', is_active: true };
const ID = '7f1c2a3b-0000-4000-8000-000000000001';

function key(scopes: string[]) {
  return { id: 'key-1', key_prefix: 'citadel_0123abcd', scopes, expires_at: null, is_revoked: false, user: BAST_USER };
}
function request(route: string) {
  const map: Record<string, string> = { authorization: 'Bearer citadel_fake_test_key', 'x-citadel-route': route };
  (headers as Mock).mockResolvedValue({ get: (n: string) => map[n.toLowerCase()] ?? null });
}

/** The exact allowlist, method and path (plan 2.1: the seven worker routes plus the chat's reads and two task writes). */
const EXPECTED = [
  'GET /api/bast-chat/worker/inbox',
  'POST /api/bast-chat/worker/heartbeat',
  'GET /api/bast-chat/worker/conversations/:id',
  'PATCH /api/bast-chat/worker/conversations/:id',
  'POST /api/bast-chat/worker/conversations/:id/events',
  'POST /api/bast-chat/worker/actions',
  'GET /api/bast-chat/worker/today',
  'POST /api/bast-chat/worker/ops',
  'GET /api/bast-chat/worker/home-keeper',
  'POST /api/bast-chat/worker/home-keeper',
  'GET /api/bast-chat/worker/home-keeper/summaries',
  'POST /api/bast-chat/worker/home-keeper/summaries',
  'GET /api/bast-chat/worker/home-keeper/learn',
  'POST /api/bast-chat/worker/home-keeper/learn',
  'GET /api/bast-chat/worker/owed',
  'POST /api/bast-chat/worker/owed',
  'GET /api/bast-chat/worker/owed/bookings',
  'POST /api/bast-chat/worker/owed/bookings',
  'GET /api/bast-chat/worker/home-watch',
  'POST /api/bast-chat/worker/home-watch',
  'POST /api/bast-chat/worker/home-watch/ack',
  'POST /api/bast-chat/worker/home-watch/scan',
  'GET /api/bast-chat/worker/reconcile',
  'POST /api/bast-chat/worker/reconcile',
  'POST /api/bast-chat/worker/reconcile/candidates',
  'POST /api/bast-chat/worker/finished',
  // Work stage D: the chat reads a piece of work's state and attaches a source to it
  'GET /api/work/:key/state',
  'POST /api/work/attach',
  'POST /api/bast-chat/worker/decision-replay',
  // Work stage F: the nightly keeper posts the ledger-derived Bast working time (work_clock only)
  'POST /api/oracle/clocks',
  'GET /api/bast-chat/worker/session-asks/:id',
  'GET /api/bast-chat/worker/sends',
  'GET /api/tasks',
  'POST /api/tasks',
  'GET /api/tasks/:id',
  'PATCH /api/tasks/:id',
  'GET /api/tasks/:id/comments',
  'POST /api/tasks/:id/checklist',
  'GET /api/tasks/:id/questions',
  'POST /api/tasks/:id/questions',
  'PATCH /api/tasks/:id/questions/:qid',
  'POST /api/tasks/:id/questions/:qid/answer',
  'GET /api/tasks/:id/triage',
  'PATCH /api/tasks/:id/triage',
  'PUT /api/tasks/:id/triage/shape',
  'GET /api/projects',
  'GET /api/projects/:id',
  'GET /api/oracle/projects',
  'GET /api/clients',
  'GET /api/clients/:id',
  'GET /api/arcs',
  'GET /api/arcs/:id',
  'GET /api/waits',
  'GET /api/email-asks',
  'GET /api/waiting-on-me',
  'GET /api/sites',
  'GET /api/sops',
  'GET /api/sops/:id',
  'GET /api/users',
];

const DESIGN_WORKER_ROUTES = LANE_ROUTES['design-worker'].map((r) => `${r.method} ${r.pattern.replace(/:\w+/g, ID)}`);

/** Routes the chat key must never reach (a sample across the surfaces the plan names). */
const REFUSED = [
  // task writes beyond create and patch
  `DELETE /api/tasks/${ID}`,
  'PATCH /api/tasks/bulk',
  'DELETE /api/tasks/bulk',
  `POST /api/tasks/${ID}/comments`,
  `POST /api/tasks/${ID}/dependencies`,
  `DELETE /api/tasks/${ID}/dependencies`,
  `POST /api/tasks/${ID}/claim`,
  `POST /api/tasks/${ID}/staged`,
  `POST /api/tasks/${ID}/approval-link`,
  'POST /api/tasks/unblock-sweep',
  // clients, projects, arcs, sops writes
  `PATCH /api/clients/${ID}`,
  `DELETE /api/clients/${ID}`,
  'POST /api/clients',
  `PATCH /api/projects/${ID}`,
  'POST /api/arcs',
  `PATCH /api/arcs/${ID}`,
  `PATCH /api/sops/${ID}`,
  // Slice 9a: the session-only route that can create a time entry
  'POST /api/home/reconcile',
  // mail
  'GET /api/email-outbox',
  `POST /api/email-outbox/${ID}/claim`,
  `POST /api/email-outbox/${ID}/sent`,
  `PATCH /api/email-asks/${ID}`,
  // settings and users (GET /api/users is in the lane for create-task.py name lookups; nothing else is)
  'GET /api/settings/bug-report',
  'PATCH /api/settings/bug-report',
  'POST /api/users',
  `GET /api/users/${ID}`,
  `PATCH /api/users/${ID}`,
  `DELETE /api/users/${ID}`,
  'GET /api/users/me',
  'PATCH /api/users/me/preferences',
  // the home screen routes
  'GET /api/home',
  'POST /api/home/act',
  'POST /api/home/undo',
  'GET /api/today',
  // keys, admin, decisions, waits writes
  'GET /api/api-keys',
  'POST /api/api-keys',
  'GET /api/admin/key-violations',
  'GET /api/decisions',
  'POST /api/waits',
  // Mike-side chat routes: the worker key never speaks as Mike
  'GET /api/bast-chat/status',
  'GET /api/bast-chat/conversations',
  'POST /api/bast-chat/conversations',
  `POST /api/bast-chat/conversations/${ID}/messages`,
  `POST /api/bast-chat/actions/${ID}/undo`,
  `POST /api/bast-chat/actions/${ID}/release`,
  'PATCH /api/bast-chat/admin/settings',
  // worker routes with the wrong method or an unlisted path
  'DELETE /api/bast-chat/worker/conversations/' + ID,
  'GET /api/bast-chat/worker/actions',
  `PATCH /api/bast-chat/worker/actions/${ID}`,
  'GET /api/bast-chat/worker/ops',
  'PATCH /api/bast-chat/worker/ops',
  'DELETE /api/bast-chat/worker/ops',
  `POST /api/bast-chat/worker/ops/${ID}`,
  'PATCH /api/bast-chat/worker/home-keeper',
  'DELETE /api/bast-chat/worker/home-keeper',
  'PATCH /api/bast-chat/worker/home-keeper/summaries',
  'DELETE /api/bast-chat/worker/home-keeper/summaries',
  'PATCH /api/bast-chat/worker/home-keeper/learn',
  'DELETE /api/bast-chat/worker/home-keeper/learn',
  'PATCH /api/bast-chat/worker/owed',
  'DELETE /api/bast-chat/worker/owed',
  'PATCH /api/bast-chat/worker/home-watch',
  'DELETE /api/bast-chat/worker/home-watch',
  'GET /api/bast-chat/worker/home-watch/ack',
  'PATCH /api/bast-chat/worker/home-watch/ack',
  'DELETE /api/bast-chat/worker/home-watch/ack',
  'GET /api/bast-chat/worker/home-watch/scan',
  'PATCH /api/bast-chat/worker/home-watch/scan',
  'DELETE /api/bast-chat/worker/home-watch/scan',
  `POST /api/bast-chat/worker/session-asks/${ID}`,
  `PATCH /api/bast-chat/worker/session-asks/${ID}`,
  `DELETE /api/bast-chat/worker/session-asks/${ID}`,
  'GET /api/bast-chat/worker/session-asks',
  // the design worker routes
  ...DESIGN_WORKER_ROUTES,
];

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyViolationThrottle();
  (cookies as Mock).mockResolvedValue({ get: () => undefined });
  (prisma.apiKey.update as Mock).mockResolvedValue({});
  createViolation.mockResolvedValue({});
  (prisma.apiKeyViolation.deleteMany as Mock).mockResolvedValue({ count: 0 });
});

describe('lane bast-chat: the list', () => {
  it('holds exactly the 57 entries of the plan, and nothing else', () => {
    expect(LANE_ROUTES['bast-chat'].map((r) => `${r.method} ${r.pattern}`)).toEqual(EXPECTED);
  });

  it('is always enforced and minted for the Bast user', () => {
    expect(ALWAYS_ENFORCED_LANES).toEqual(['design-worker', 'bast-chat', 'design-track', 'design-notes', 'dox']); // designer portal v2 adds its two born-enforced lanes; Dox is born enforced
    expect(LANE_IDENTITY['bast-chat']).toBe('bast');
  });

  it('has no DELETE and no write outside the two task routes, the checklist route and its own worker routes', () => {
    const writes = LANE_ROUTES['bast-chat'].filter((r) => r.method !== 'GET');
    expect(writes.some((r) => r.method === 'DELETE')).toBe(false);
    for (const r of writes) {
      const ok = r.pattern.startsWith('/api/bast-chat/worker/') || r.pattern === '/api/tasks' || r.pattern === '/api/tasks/:id' || r.pattern === '/api/tasks/:id/checklist' || r.pattern.startsWith('/api/tasks/:id/questions') || r.pattern === '/api/tasks/:id/triage' || r.pattern === '/api/tasks/:id/triage/shape' || r.pattern === '/api/work/attach' || r.pattern === '/api/oracle/clocks';
      expect(ok, `${r.method} ${r.pattern}`).toBe(true);
    }
  });

  it.each(REFUSED)('refuses %s', (route) => {
    const i = route.indexOf(' ');
    expect(laneAllows('bast-chat', route.slice(0, i), route.slice(i + 1))).toBe(false);
  });
});

describe('lane bast-chat: no other lane gained anything', () => {
  it('every other lane route list is byte for byte the one on main before this build', () => {
    // Fingerprint of "<lane> <METHOD> <pattern>" lines for every lane but bast-chat, taken from origin/main 7a5f1ef (work stage A and work stage B each add one porter line).
    // The dox lane (a new lane; its own list is pinned in lane-dox.test.ts) is left out so this stays the fingerprint of the lanes that existed.
    const rows = LANES.filter((l) => l !== 'bast-chat' && l !== 'dox').flatMap((l) => LANE_ROUTES[l].map((r) => `${l} ${r.method} ${r.pattern}`));
    expect(rows).toHaveLength(195); // 174 before designer portal v2, plus its 20: design-track 14, design-notes 3 and three design-worker lines (session context GET, art-direction PATCH, track-assets GET). Without those 20 and the one worker-lane question read the fingerprint is still 78ffa238...c25f48. Before that: 155 on main plus porter POST /api/work/backfill-links (work stage A) and POST /api/work/apply-decisions (work stage B), ten lines of work stage D (porter 3, bast 3, courier 1, oracle 3: the state read, the attach and the evidence routes), and six oracle lines of work stage E (the work index, the session links, evidence, close-task and track routes, and the stale-asks clear), and oracle POST /api/oracle/clocks (work stage F)
    expect(createHash('sha256').update(rows.join('\n')).digest('hex')).toBe(
      '6166cfd0f9c395808b99b9c87baa1949c2393258fad8d3071ea5eaea39ebc4b3', // 93f784924b55... plus the worker lane's one GET /api/tasks/:id/questions; was 78ffa238... plus the 20 designer portal v2 lines; 78ffa238 was main's 20f12653... plus the two porter lines of work stages A and B, the ten of work stage D and the six oracle lines of work stage E and the one oracle line of work stage F
    );
  });

  it('no other lane reaches a bast-chat route', () => {
    const chatRoutes = [
      ...EXPECTED.filter((e) => e.includes('/api/bast-chat/')),
      'GET /api/bast-chat/status',
      'POST /api/bast-chat/conversations',
      `PATCH /api/bast-chat/admin/settings`,
    ].map((e) => e.replace(/:\w+/g, ID));
    for (const l of LANES.filter((x) => x !== 'bast-chat')) {
      for (const route of chatRoutes) {
        const i = route.indexOf(' ');
        expect(laneAllows(l, route.slice(0, i), route.slice(i + 1)), `${l}: ${route}`).toBe(false);
      }
    }
  });
});

describe('lane bast-chat: the key', () => {
  it('mint and PATCH refuse a bast-chat key without the enforce scope, or with a second lane', () => {
    expect(keyScopesSchema.safeParse(['lane:bast-chat', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:bast-chat']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:bast-chat', 'lane:bast', 'scope-mode:enforce']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:bast-chat', 'scope-mode:enforce', 'engine']).success).toBe(false);
  });

  it.each(EXPECTED.map((e) => e.replace(/:\w+/g, ID)))('the enforced key authenticates on %s', async (route) => {
    findKey.mockResolvedValue(key(['lane:bast-chat', 'scope-mode:enforce']));
    request(route);
    const auth = await requireAuth();
    expect(auth.lane).toBe('bast-chat');
    expect(auth.laneEnforced).toBe(true);
    expect(auth.via).toBe('api_key');
    expect(createViolation).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('the enforced key is 403 and logged on %s', async (route) => {
    findKey.mockResolvedValue(key(['lane:bast-chat', 'scope-mode:enforce']));
    request(route);
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    expect(createViolation).toHaveBeenCalledTimes(1);
    expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'bast-chat', enforced: true });
  });

  it('a key planted without the enforce scope is still refused outside the lane (never shadow)', async () => {
    findKey.mockResolvedValue(key(['lane:bast-chat']));
    for (const route of [`DELETE /api/tasks/${ID}`, `PATCH /api/clients/${ID}`, 'GET /api/email-outbox', 'POST /api/home/act']) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(route);
      await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
      expect(createViolation).toHaveBeenCalledTimes(1);
      expect(createViolation.mock.calls[0][0].data).toMatchObject({ lane: 'bast-chat', enforced: true });
    }
  });

  it('a key planted without the enforce scope authenticates in the lane but reports laneEnforced false', async () => {
    // requireChatWorker (plan task C2) must check laneEnforced, as isDesignWorker does.
    findKey.mockResolvedValue(key(['lane:bast-chat']));
    request('GET /api/bast-chat/worker/inbox');
    const auth = await requireAuth();
    expect(auth.lane).toBe('bast-chat');
    expect(auth.laneEnforced).toBe(false);
  });
});
