import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Dox lane (PLAN-dox-office-manager slice 1): born enforced, acts as Bast, exactly the routes the office manager needs and nothing that moves a card out of Triage, answers, deletes or sends.
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
  ['GET', '/api/users'],
  ['GET', '/api/projects'],
  ['POST', '/api/projects'],
  ['GET', '/api/projects/7f1c'],
  ['GET', '/api/projects/7f1c/engagement-snapshot'],
  ['POST', '/api/projects/7f1c/engagement-brief'],
  ['PATCH', '/api/projects/7f1c'],
  ['GET', '/api/tasks'],
  ['GET', '/api/tasks/7f1c'],
  ['POST', '/api/tasks'],
  ['PATCH', '/api/tasks/7f1c'],
  ['GET', '/api/tasks/7f1c/comments'],
  ['POST', '/api/tasks/7f1c/comments'],
  ['GET', '/api/tasks/7f1c/questions'],
  ['POST', '/api/tasks/7f1c/questions'],
  ['GET', '/api/tasks/7f1c/triage'],
  ['GET', '/api/work/task/7f1c/state'],
  ['GET', '/api/waits'],
  ['POST', '/api/waits'],
  ['PATCH', '/api/waits/7f1c'],
  ['GET', '/api/engagement-briefs'],
  ['GET', '/api/engagement-briefs/7f1c'],
  ['GET', '/api/engagement-briefs/7f1c/tasks'],
  ['GET', '/api/engagement-briefs/7f1c/snapshot'],
  ['POST', '/api/engagement-briefs/7f1c/passes'],
  ['PATCH', '/api/engagement-passes/7f1c'],
];

const DENIED: [string, string][] = [
  // moving anything out of Triage: sorting, releasing, the shape, dropping, closing as done
  ['PATCH', '/api/tasks/7f1c/triage'],
  ['PUT', '/api/tasks/7f1c/triage/shape'],
  ['POST', '/api/home/act'],
  ['POST', '/api/home/undo'],
  // answering and editing questions
  ['POST', '/api/tasks/7f1c/questions/9a/answer'],
  ['PATCH', '/api/tasks/7f1c/questions/9a'],
  // deleting
  ['DELETE', '/api/tasks/7f1c'],
  ['DELETE', '/api/projects/7f1c'],
  ['DELETE', '/api/waits/7f1c'],
  ['DELETE', '/api/engagement-briefs/7f1c'],
  ['DELETE', '/api/tasks/7f1c/comments'],
  // sending to clients: the outbox, approvals, the portal, notices, the courier
  ['POST', '/api/email-outbox/7f1c/sent'],
  ['GET', '/api/email-outbox'],
  ['POST', '/api/approval-requests/7f1c/reply'],
  ['PUT', '/api/approval-requests/7f1c/sent'],
  ['POST', '/api/tasks/7f1c/approval-link'],
  ['POST', '/api/tasks/7f1c/notify-requestor'],
  ['POST', '/api/portal-chat/inbound'],
  ['PUT', '/api/portal-notices/7f1c/sent'],
  ['POST', '/api/tasks/7f1c/live'],
  ['POST', '/api/tasks/7f1c/staged'],
  // brief rewrites and the owner pass's own settings
  ['PUT', '/api/engagement-briefs'],
  ['PATCH', '/api/engagement-briefs/7f1c'],
  // other task writes, claims, checklist, dependencies, bulk, moves
  ['POST', '/api/tasks/7f1c/dependencies'],
  ['POST', '/api/tasks/7f1c/claim'],
  ['POST', '/api/tasks/7f1c/checklist'],
  ['PATCH', '/api/tasks/bulk'],
  ['POST', '/api/tasks/7f1c/move'],
  ['POST', '/api/time-entries'],
  // other lanes' routes
  ['POST', '/api/bast-chat/worker/ops'],
  ['GET', '/api/design/runner/candidates'],
  ['POST', '/api/waits/sweep'],
  ['POST', '/api/tasks/unblock-sweep'],
  ['GET', '/api/api-keys'],
  ['POST', '/api/api-keys'],
  ['GET', '/api/clients'],
];

describe('lane dox', () => {
  it('is always enforced, acts as Bast, and a key for it must carry scope-mode:enforce', () => {
    expect(ALWAYS_ENFORCED_LANES).toContain('dox');
    expect(LANE_IDENTITY.dox).toBe('bast');
    expect(keyScopesSchema.safeParse(['lane:dox']).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:dox', 'scope-mode:enforce']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:dox', 'lane:bast', 'scope-mode:enforce']).success).toBe(false);
  });

  it('the lane list holds exactly the allowed routes and each one is allowed', () => {
    expect(LANE_ROUTES.dox).toHaveLength(ALLOWED.length);
    for (const [m, p] of ALLOWED) expect(laneAllows('dox', m, p), `${m} ${p}`).toBe(true);
  });

  it('refuses moving out of Triage, answering, deleting, client sends and everything else not listed', () => {
    for (const [m, p] of DENIED) expect(laneAllows('dox', m, p), `${m} ${p}`).toBe(false);
  });

  it('no allowed route is a DELETE, and no write reaches an answer, approval, outbox or portal path', () => {
    for (const r of LANE_ROUTES.dox) {
      expect(r.method).not.toBe('DELETE');
      expect(r.method).not.toBe('PUT');
      if (r.method !== 'GET') expect(r.pattern).not.toMatch(/answer|approval|outbox|portal|notice|triage|live|staged|notify|send/);
    }
  });

  it('only Dox, bast-chat and bast reach what they should of the Triage card read and the question write', () => {
    expect(laneAllows('dox', 'GET', '/api/tasks/7f1c/triage')).toBe(true);
    for (const lane of LANES.filter((l) => l !== 'bast-chat' && l !== 'dox')) {
      expect(laneAllows(lane, 'GET', '/api/tasks/7f1c/triage'), lane).toBe(false);
    }
    for (const lane of LANES.filter((l) => l !== 'bast-chat' && l !== 'dox')) {
      expect(laneAllows(lane, 'POST', '/api/tasks/7f1c/questions'), lane).toBe(false);
    }
  });

  it('an enforced Dox key authenticates with lane dox on its routes', async () => {
    findKey.mockResolvedValue(key(['lane:dox', 'scope-mode:enforce']));
    request('GET /api/engagement-briefs/7f1c/snapshot');
    const auth = await requireAuth();
    expect(auth.lane).toBe('dox');
    expect(auth.laneEnforced).toBe(true);
    expect(createViolation).not.toHaveBeenCalled();
  });

  it('enforce: the Dox key is refused (403, logged) outside its lane, answers and deletes included', async () => {
    findKey.mockResolvedValue(key(['lane:dox', 'scope-mode:enforce']));
    for (const [m, p] of DENIED) {
      createViolation.mockClear();
      resetKeyViolationThrottle();
      request(`${m} ${p.replace('7f1c', '7f1c')}`);
      await expect(requireAuth(), `${m} ${p}`).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a Dox key planted without scope-mode:enforce is still refused outside the lane', async () => {
    findKey.mockResolvedValue(key(['lane:dox']));
    request('POST /api/tasks/7f1c/questions/9a/answer');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
    request('DELETE /api/tasks/7f1c');
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 403 });
  });
});
