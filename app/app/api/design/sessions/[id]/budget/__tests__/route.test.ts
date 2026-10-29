import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { ApiError } from '@/lib/api/errors';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) }, designSession: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/budget', async (orig) => ({ ...(await orig<typeof import('@/lib/design/budget')>()), raiseBudget: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { raiseBudget } from '@/lib/design/budget';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const raise = raiseBudget as Mock;
const call = (body: unknown, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/budget`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));
const arrange = () => { sessionFind.mockResolvedValue(sessionRow()); raise.mockResolvedValue({ session: sessionRow({ budget_usd: 40 }), resume_command_id: null }); };
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('POST /api/design/sessions/:id/budget', () => {
  it('raises the budget through raiseBudget with the DB-role actor', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ budget_usd: 40 });
    expect(res.status).toBe(200);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ role: 'designer', role_source: 'db' }), SESSION_ID, 40);
    expect((await res.json()).session.budget_usd).toBe(40);
  });
  it('passes the service refusals through (403 raise_cap, 400 not_a_raise)', async () => {
    signIn(auth, userFind, 'designer');
    raise.mockRejectedValueOnce(new ApiError('cap', 403, 'raise_cap'));
    expect((await call({ budget_usd: 400 })).status).toBe(403);
    raise.mockRejectedValueOnce(new ApiError('no', 400, 'not_a_raise'));
    expect((await call({ budget_usd: 1 })).status).toBe(400);
  });
  it('zod: missing, zero, negative, string, NaN-ish are 400', async () => {
    signIn(auth, userFind, 'designer');
    for (const b of [{}, { budget_usd: 0 }, { budget_usd: -5 }, { budget_usd: '40' }, { budget_usd: 1e9 }]) expect((await call(b)).status).toBe(400);
    expect((await call(JSON.stringify({ budget_usd: 40, pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  sessionRouteMatrix('budget', { invoke: (h) => call({ budget_usd: 40 }, h), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange, write: true });
});

describe('W8.2 N8 on budget', () => {
  it('an unknown field is 400, nothing raised', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ budget_usd: 40, cap_override: true })).status).toBe(400);
    expect(raise).not.toHaveBeenCalled();
  });
});
