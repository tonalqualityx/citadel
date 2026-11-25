import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Front-session lane (project 1e374bad; Mike, 2026-11-24: "The bast session will need to be able to release triage cards"): born enforced, acts as
// Bast, reaches exactly four routes (release a Triage card on Mike's words; record his words on a card as a silent internal comment, Mike,
// 2026-11-24: "every time you attach a comment from me on a card I get a slack notification. Would love for that to stop."; read a card's
// questions and answer one with his words, Mike, 2026-11-24: "fix that issue in Citadel so we can answer questions from here") and is refused
// everywhere else.
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
import { ALWAYS_ENFORCED_LANES, LANES, LANE_IDENTITY, LANE_ROUTES, laneAllows } from '../lane-scopes';
import { keyScopesSchema } from '../key-scopes';

const findKey = prisma.apiKey.findFirst as Mock;
const createViolation = prisma.apiKeyViolation.create as Mock;
const BAST_USER = { id: 'bast-1', email: 'bast@becomeindelible.com', role: 'pm', is_active: true };

function key(scopes: string[], user = BAST_USER) {
  return { id: 'key-1', key_prefix: 'citadel_0123abcd', scopes, expires_at: null, is_revoked: false, user };
}
function request(route: string) {
  const map: Record<string, string> = { authorization: 'Bearer citadel_fake_test_key', 'x-citadel-route': route };
  (headers as Mock).mockResolvedValue({ get: (n: string) => map[n.toLowerCase()] ?? null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyViolationThrottle();
  (cookies as Mock).mockResolvedValue({ get: () => undefined });
  (prisma.apiKey.update as Mock).mockResolvedValue({});
  createViolation.mockResolvedValue({});
  (prisma.apiKeyViolation.deleteMany as Mock).mockResolvedValue({ count: 0 });
});

const RELEASE = '/api/tasks/7f1c/triage/release';
const COMMENT = '/api/tasks/7f1c/comments';
const QUESTIONS = '/api/tasks/7f1c/questions';
const ANSWER = '/api/tasks/7f1c/questions/9a/answer';

const DENIED: [string, string][] = [
  // every other way to move a card or a task
  ['PATCH', '/api/tasks/7f1c'],
  ['PATCH', '/api/tasks/bulk'],
  ['POST', '/api/home/act'],
  ['POST', '/api/home/undo'],
  ['PATCH', '/api/tasks/7f1c/triage'],
  ['PUT', '/api/tasks/7f1c/triage/shape'],
  ['GET', '/api/tasks/7f1c/triage'],
  ['GET', RELEASE],
  ['PUT', RELEASE],
  ['PATCH', RELEASE],
  ['DELETE', RELEASE],
  // reading or writing anything else
  ['GET', '/api/auth/me'],
  ['GET', '/api/tasks'],
  ['POST', '/api/tasks'],
  ['GET', '/api/tasks/7f1c'],
  ['DELETE', '/api/tasks/7f1c'],
  ['GET', COMMENT],
  ['PATCH', COMMENT],
  ['DELETE', COMMENT],
  ['PATCH', '/api/comments/c1'],
  ['DELETE', '/api/comments/c1'],
  // questions: read and answer only; never ask, edit, withdraw or block
  ['POST', QUESTIONS],
  ['PATCH', '/api/tasks/7f1c/questions/9a'],
  ['GET', ANSWER],
  ['PATCH', ANSWER],
  ['POST', '/api/tasks/7f1c/questions/9a/blocks'],
  ['GET', '/api/questions'],
  ['POST', '/api/projects/p1/questions/9a/answer'],
  ['PATCH', '/api/tasks/7f1c/plan'],
  ['POST', '/api/tasks/7f1c/live'],
  ['POST', '/api/tasks/7f1c/staged'],
  ['POST', '/api/bast-chat/worker/ops'],
  ['GET', '/api/email-outbox'],
  ['GET', '/api/clients'],
  ['GET', '/api/projects'],
  ['GET', '/api/api-keys'],
];

describe('lane front-session', () => {
  it('is always enforced, acts as Bast, and a key for it must carry scope-mode:enforce and no other lane', () => {
    expect(LANES).toContain('front-session');
    expect(ALWAYS_ENFORCED_LANES).toContain('front-session');
    expect(LANE_IDENTITY['front-session']).toBe('bast');
    expect(keyScopesSchema.safeParse(['lane:front-session']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:front-session', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:front-session', 'lane:bast-chat', 'scope-mode:enforce']).success).toBe(false);
  });

  it('holds exactly four routes: POST release, POST a comment, GET a card\'s questions and POST an answer', () => {
    expect(LANE_ROUTES['front-session'].map((r) => `${r.method} ${r.pattern}`)).toEqual([
      'POST /api/tasks/:id/triage/release',
      'POST /api/tasks/:id/comments',
      'GET /api/tasks/:id/questions',
      'POST /api/tasks/:id/questions/:qid/answer',
    ]);
    expect(laneAllows('front-session', 'POST', RELEASE)).toBe(true);
    expect(laneAllows('front-session', 'POST', COMMENT)).toBe(true);
    expect(laneAllows('front-session', 'GET', QUESTIONS)).toBe(true);
    expect(laneAllows('front-session', 'POST', ANSWER)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const [m, p] of DENIED) expect(laneAllows('front-session', m, p), `${m} ${p}`).toBe(false);
  });

  it('no other lane reaches the release route', () => {
    for (const lane of LANES.filter((l) => l !== 'front-session')) expect(laneAllows(lane, 'POST', RELEASE), lane).toBe(false);
  });

  it('an enforced front-session key authenticates with its lane on the release route', async () => {
    findKey.mockResolvedValue(key(['lane:front-session', 'scope-mode:enforce']));
    request(`POST ${RELEASE}`);
    const auth = await requireAuth();
    expect(auth.lane).toBe('front-session');
    expect(auth.laneEnforced).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('an enforced front-session key authenticates with its lane on the comment route', async () => {
    findKey.mockResolvedValue(key(['lane:front-session', 'scope-mode:enforce']));
    request(`POST ${COMMENT}`);
    const auth = await requireAuth();
    expect(auth.lane).toBe('front-session');
    expect(auth.laneEnforced).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('an enforced front-session key authenticates with its lane on the answer route', async () => {
    findKey.mockResolvedValue(key(['lane:front-session', 'scope-mode:enforce']));
    request(`POST ${ANSWER}`);
    const auth = await requireAuth();
    expect(auth.lane).toBe('front-session');
    expect(auth.laneEnforced).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('enforce: the key is refused (403, logged) on every other route', async () => {
    findKey.mockResolvedValue(key(['lane:front-session', 'scope-mode:enforce']));
    for (const [m, p] of DENIED) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(`${m} ${p}`);
      await expect(requireAuth(), `${m} ${p}`).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('on the release route itself: no credentials is 401, and another lane\'s enforced key is refused 403 by the lane check', async () => {
    (headers as Mock).mockResolvedValue({ get: (n: string) => (n.toLowerCase() === 'x-citadel-route' ? `POST ${RELEASE}` : null) });
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    for (const lane of ['bast-chat', 'triage-desk', 'bast', 'dox']) {
      findKey.mockResolvedValue(key([`lane:${lane}`, 'scope-mode:enforce']));
      request(`POST ${RELEASE}`);
      await expect(requireAuth(), lane).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a key planted without scope-mode:enforce is still refused outside the lane', async () => {
    findKey.mockResolvedValue(key(['lane:front-session']));
    request('PATCH /api/tasks/7f1c');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    request('POST /api/home/act');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
  });
});
