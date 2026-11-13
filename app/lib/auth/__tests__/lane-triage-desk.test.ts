import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Triage-desk lane (PLAN-triage-investigations decision 5): born enforced, acts as Bast, reads a card and its chat and edits the card, and nothing that releases, drops, closes, answers, sends or deletes.
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


const ALLOWED: [string, string][] = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/tasks/7f1c'],
  ['PATCH', '/api/tasks/7f1c'],
  ['GET', '/api/tasks/7f1c/comments'],
  ['POST', '/api/tasks/7f1c/comments'],
  ['GET', '/api/tasks/7f1c/questions'],
  ['POST', '/api/tasks/7f1c/questions'],
  ['PATCH', '/api/tasks/7f1c/questions/9a'],
  ['GET', '/api/tasks/7f1c/triage'],
  ['PATCH', '/api/tasks/7f1c/triage'],
  ['PUT', '/api/tasks/7f1c/triage/shape'],
  ['GET', '/api/tasks/7f1c/conversation'],
  ['GET', '/api/projects'],
];

const DENIED: [string, string][] = [
  // answering a question
  ['POST', '/api/tasks/7f1c/questions/9a/answer'],
  // chat ops, the chat's own routes, the home actions that release, drop or close a card
  ['POST', '/api/bast-chat/worker/ops'],
  ['POST', '/api/bast-chat/worker/actions'],
  ['GET', '/api/bast-chat/worker/inbox'],
  ['POST', '/api/home/act'],
  ['POST', '/api/home/undo'],
  // deleting
  ['DELETE', '/api/tasks/7f1c'],
  ['DELETE', '/api/projects/7f1c'],
  ['DELETE', '/api/tasks/7f1c/comments'],
  // creating or changing other things
  ['POST', '/api/tasks'],
  ['POST', '/api/projects'],
  ['PATCH', '/api/projects/7f1c'],
  ['GET', '/api/projects/7f1c'],
  ['POST', '/api/waits'],
  ['PATCH', '/api/waits/7f1c'],
  ['POST', '/api/tasks/7f1c/checklist'],
  ['POST', '/api/tasks/7f1c/dependencies'],
  ['POST', '/api/tasks/7f1c/claim'],
  ['PATCH', '/api/tasks/bulk'],
  ['POST', '/api/tasks/7f1c/move'],
  ['GET', '/api/clients'],
  ['GET', '/api/clients/7f1c'],
  ['GET', '/api/accords'],
  ['GET', '/api/charters'],
  // sending to clients
  ['POST', '/api/email-outbox/7f1c/sent'],
  ['GET', '/api/email-outbox'],
  ['POST', '/api/approval-requests/7f1c/reply'],
  ['POST', '/api/tasks/7f1c/approval-link'],
  ['POST', '/api/tasks/7f1c/notify-requestor'],
  ['POST', '/api/tasks/7f1c/live'],
  ['POST', '/api/tasks/7f1c/staged'],
  ['POST', '/api/portal-chat/inbound'],
  // keys
  ['GET', '/api/api-keys'],
  ['POST', '/api/api-keys'],
  // other lanes' routes
  ['GET', '/api/design/runner/candidates'],
  ['POST', '/api/waits/sweep'],
  ['POST', '/api/tasks/unblock-sweep'],
  ['GET', '/api/engagement-briefs/7f1c'],
];

describe('lane triage-desk', () => {
  it('is always enforced, acts as Bast, and a key for it must carry scope-mode:enforce', () => {
    expect(ALWAYS_ENFORCED_LANES).toContain('triage-desk');
    expect(LANES).toContain('triage-desk');
    expect(LANE_IDENTITY['triage-desk']).toBe('bast');
    expect(keyScopesSchema.safeParse(['lane:triage-desk']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:triage-desk', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:triage-desk', 'lane:bast-chat', 'scope-mode:enforce']).success).toBe(false);
  });

  it('the lane list holds exactly the allowed routes and each one is allowed', () => {
    expect(LANE_ROUTES['triage-desk']).toHaveLength(ALLOWED.length);
    for (const [m, p] of ALLOWED) expect(laneAllows('triage-desk', m, p), `${m} ${p}`).toBe(true);
  });

  it('refuses answering, chat ops, releasing, deleting, client sends and everything else not listed', () => {
    for (const [m, p] of DENIED) expect(laneAllows('triage-desk', m, p), `${m} ${p}`).toBe(false);
  });

  it('no allowed route is a DELETE, and no write reaches an answer, approval, outbox, portal, send or chat path', () => {
    for (const r of LANE_ROUTES['triage-desk']) {
      expect(r.method).not.toBe('DELETE');
      if (r.method !== 'GET') expect(r.pattern).not.toMatch(/answer|approval|outbox|portal|notice|live|staged|notify|send|bast-chat|home/);
    }
  });

  it('only the triage desk and the lanes that already had them reach the conversation read; no other lane reaches it', () => {
    for (const lane of LANES.filter((l) => l !== 'triage-desk')) {
      expect(laneAllows(lane, 'GET', '/api/tasks/7f1c/conversation'), lane).toBe(false);
    }
  });

  it('an enforced triage-desk key authenticates with lane triage-desk on its routes', async () => {
    findKey.mockResolvedValue(key(['lane:triage-desk', 'scope-mode:enforce']));
    request('GET /api/tasks/7f1c/conversation');
    const auth = await requireAuth();
    expect(auth.lane).toBe('triage-desk');
    expect(auth.laneEnforced).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('enforce: the key is refused (403, logged) outside its lane', async () => {
    findKey.mockResolvedValue(key(['lane:triage-desk', 'scope-mode:enforce']));
    for (const [m, p] of DENIED) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(`${m} ${p}`);
      await expect(requireAuth(), `${m} ${p}`).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a key planted without scope-mode:enforce is still refused outside the lane', async () => {
    findKey.mockResolvedValue(key(['lane:triage-desk']));
    request('POST /api/tasks/7f1c/questions/9a/answer');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    request('POST /api/home/act');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
  });
});
