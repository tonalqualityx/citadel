import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET, POST } from '../route';
import { ApiError } from '@/lib/api/errors';
import { getRequest, jsonRequest, signIn, anonymous, sessionRow, TASK_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, designSession: { findMany: vi.fn() }, designPublish: { findMany: vi.fn() } },
}));
vi.mock('@/lib/design/sessions', async (orig) => ({ ...(await orig<typeof import('@/lib/design/sessions')>()), createOrGetSession: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession } from '@/lib/design/sessions';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const findMany = prisma.designSession.findMany as Mock;
const pubFind = prisma.designPublish.findMany as Mock;
const create = createOrGetSession as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: 's1', status: 'awaiting_input', cost_usd: 2, budget_usd: 25, updated_at: new Date(), last_publish_id: 'p1', task: { id: 't1', title: 'Home' }, site: { name: 'VCDP' } },
  ]);
  pubFind.mockResolvedValue([{ id: 'p1', status: 'published', finished_at: new Date('2026-10-28T10:00:00Z') }]);
});

describe('GET /api/design/sessions', () => {
  it('a designer lists only her own sessions', async () => {
    const uid = signIn(auth, userFind, 'designer');
    const res = await GET(getRequest('/api/design/sessions'));
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ designer_id: uid });
    const json = await res.json();
    expect(json.sessions[0]).toMatchObject({ id: 's1', task: { id: 't1', title: 'Home' }, site: { name: 'VCDP' }, last_publish: { id: 'p1', status: 'published' }, cost_usd: 2, budget_usd: 25 });
  });
  it('an admin lists all, with a status filter', async () => {
    signIn(auth, userFind, 'admin');
    expect((await GET(getRequest('/api/design/sessions?status=active'))).status).toBe(200);
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'active' });
  });
  it('an unknown status is 400, pm is 403, anonymous is 401', async () => {
    signIn(auth, userFind, 'admin');
    expect((await GET(getRequest('/api/design/sessions?status=bogus'))).status).toBe(400);
    signIn(auth, userFind, 'pm');
    expect((await GET(getRequest('/api/design/sessions'))).status).toBe(403);
    anonymous(auth);
    expect((await GET(getRequest('/api/design/sessions'))).status).toBe(401);
  });
});

describe('POST /api/design/sessions', () => {
  it('201 for a new session, 200 for an existing one', async () => {
    signIn(auth, userFind, 'designer');
    create.mockResolvedValueOnce({ session: sessionRow(), created: true }).mockResolvedValueOnce({ session: sessionRow(), created: false });
    const a = await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }));
    const b = await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }));
    expect([a.status, b.status]).toEqual([201, 200]);
    expect((await a.json()).session).toMatchObject({ task_id: TASK_ID, status: 'awaiting_input' });
  });
  it('passes service refusals through (404, 409 portal_disabled/site_not_available/session_owned)', async () => {
    signIn(auth, userFind, 'designer');
    for (const [status, code] of [[404, 'not_found'], [409, 'portal_disabled'], [409, 'site_not_available'], [409, 'session_owned']] as const) {
      create.mockRejectedValueOnce(new ApiError('x', status, code));
      const res = await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }));
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
    }
  });
  it('zod: missing or malformed task_id is 400; a big body is 413', async () => {
    signIn(auth, userFind, 'designer');
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', {}))).status).toBe(400);
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: 'x' }))).status).toBe(400);
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', JSON.stringify({ task_id: TASK_ID, pad: 'x'.repeat(5000) })))).status).toBe(413);
  });
  it('cross-site is 403, anonymous is 401, pm is 403 (service refuses)', async () => {
    signIn(auth, userFind, 'designer');
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    anonymous(auth);
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }))).status).toBe(401);
    signIn(auth, userFind, 'pm');
    create.mockRejectedValueOnce(new ApiError('Forbidden', 403, 'forbidden'));
    expect((await POST(jsonRequest('/api/design/sessions', 'POST', { task_id: TASK_ID }))).status).toBe(403);
  });
});
