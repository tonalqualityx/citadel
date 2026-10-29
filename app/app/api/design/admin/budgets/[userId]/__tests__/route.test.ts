import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PUT, PATCH } from '../route';
import { jsonRequest, signIn, anonymous, DESIGNER_ID, ADMIN_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, designBudget: { upsert: vi.fn() } } }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const upsert = prisma.designBudget.upsert as Mock;
const put = (body: unknown, headers?: Record<string, string>, id = DESIGNER_ID) =>
  PUT(jsonRequest(`/api/design/admin/budgets/${id}`, 'PUT', body, headers), { params: Promise.resolve({ userId: id }) });
const patch = (body: unknown) => PATCH(jsonRequest(`/api/design/admin/budgets/${DESIGNER_ID}`, 'PATCH', body), { params: Promise.resolve({ userId: DESIGNER_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  userFind.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: 'Dee', role: where.id === ADMIN_ID ? 'admin' : 'designer', is_active: true }));
  upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({ user_id: DESIGNER_ID, monthly_cap_usd: update.monthly_cap_usd ?? null, session_raise_cap_usd: update.session_raise_cap_usd ?? null }));
});

describe('PUT/PATCH /api/design/admin/budgets/:userId', () => {
  it('sets the caps; null clears; PATCH is the same merge', async () => {
    const res = await put({ monthly_cap_usd: 300, session_raise_cap_usd: 80 });
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0].update).toEqual({ monthly_cap_usd: 300, session_raise_cap_usd: 80, updated_by_id: ADMIN_ID });
    expect((await res.json()).budget).toMatchObject({ user: { id: DESIGNER_ID }, monthly_cap_usd: 300, session_raise_cap_usd: 80 });
    expect((await put({ monthly_cap_usd: null })).status).toBe(200);
    expect(upsert.mock.calls[1][0].update).toEqual({ monthly_cap_usd: null, updated_by_id: ADMIN_ID });
    expect((await patch({ session_raise_cap_usd: 60 })).status).toBe(200);
  });
  it('zod: empty, unknown field, negative, string are 400; 413 over the cap', async () => {
    for (const b of [{}, { x: 1 }, { monthly_cap_usd: -1 }, { monthly_cap_usd: '5' }, { session_raise_cap_usd: 99999 }]) expect((await put(b)).status, JSON.stringify(b)).toBe(400);
    expect((await put(JSON.stringify({ monthly_cap_usd: 1, pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  it('unknown or malformed user is 404', async () => {
    userFind.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === ADMIN_ID ? { id: ADMIN_ID, name: 'M', role: 'admin', is_active: true } : null));
    expect((await put({ monthly_cap_usd: 1 })).status).toBe(404);
    expect((await put({ monthly_cap_usd: 1 }, undefined, 'nope')).status).toBe(404);
  });
  it('cross-site 403; anonymous 401; non-admin and API key 403', async () => {
    expect((await put({ monthly_cap_usd: 1 }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await put({ monthly_cap_usd: 1 })).status).toBe(401);
    for (const role of ['designer', 'pm'] as const) { signIn(auth, userFind, role); expect((await put({ monthly_cap_usd: 1 })).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await put({ monthly_cap_usd: 1 })).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
