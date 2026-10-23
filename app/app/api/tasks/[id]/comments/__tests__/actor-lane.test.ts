import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Fleet item 6: a comment written with a lane key carries actor_lane, stamped on the server from
// the key itself. A client cannot set it.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    comment: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
    apiKey: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/portal/share-reply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/share-reply')>();
  return { ...actual, afterReplyShared: vi.fn() };
});
vi.mock('@/lib/services/notifications', () => ({ createNotification: vi.fn() }));

import { cookies, headers } from 'next/headers';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { rememberKeyLane, resetActorLaneCache } from '@/lib/auth/actor-lane';
import { POST } from '../route';

const BAST = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const ctx = { params: Promise.resolve({ id: 'task-1' }) };
const create = prisma.comment.create as Mock;
const findKey = prisma.apiKey.findFirst as Mock;

function as(bearer: string | null, cookie: string | null = null) {
  (headers as Mock).mockResolvedValue({ get: (n: string) => (n === 'authorization' && bearer ? `Bearer ${bearer}` : null) });
  (cookies as Mock).mockResolvedValue({ get: (n: string) => (n === 'access_token' && cookie ? { value: cookie } : undefined) });
}
const post = (body: object) =>
  POST(new NextRequest('http://localhost:3000/api/tasks/task-1/comments', { method: 'POST', body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  resetActorLaneCache();
  (requireAuth as Mock).mockResolvedValue({ userId: BAST, role: 'pm' });
  (prisma.task.findUnique as Mock).mockResolvedValue({ id: 'task-1', title: 'T', project_id: null, assignee_id: BAST, assignee: { id: BAST } });
  (prisma.user.findMany as Mock).mockResolvedValue([]);
  (prisma.user.findUnique as Mock).mockResolvedValue({ name: 'Bast' });
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'c1', task_id: 'task-1', user_id: BAST, content: data.content, mentioned_user_ids: [], is_internal: false,
    client_visible: false, client_question: false, created_at: new Date(), updated_at: new Date(),
    user: { id: BAST, name: 'Bast', email: 'b@x', avatar_url: null },
  }));
});

describe('comment actor_lane', () => {
  it('a lane key stamps its lane (from the key, cached by authenticateApiKey)', async () => {
    rememberKeyLane(hashApiKey('citadel_fake_porter'), 'porter');
    as('citadel_fake_porter');
    expect((await post({ content: 'filed from intake' })).status).toBe(201);
    expect(create.mock.calls[0][0].data.actor_lane).toBe('porter');
    expect(findKey).not.toHaveBeenCalled();
  });

  it('falls back to the key row when nothing is cached', async () => {
    findKey.mockResolvedValue({ scopes: ['lane:bast', 'scope-mode:enforce'] });
    as('citadel_fake_worker');
    await post({ content: 'worker note' });
    expect(create.mock.calls[0][0].data.actor_lane).toBe('bast');
  });

  it('a body field named actor_lane is ignored: a browser session writes no lane', async () => {
    as(null, 'jwt');
    await post({ content: 'hi', actor_lane: 'porter' });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('actor_lane');
  });

  it('a client cannot plant a lane with a bearer that has none', async () => {
    findKey.mockResolvedValue({ scopes: [] });
    as('citadel_fake_unscoped');
    await post({ content: 'hi', actor_lane: 'courier' });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('actor_lane');
  });

  it('a session cookie wins over a bearer, so no lane', async () => {
    rememberKeyLane(hashApiKey('citadel_fake_porter'), 'porter');
    as('citadel_fake_porter', 'jwt');
    await post({ content: 'hi' });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('actor_lane');
  });

  it('outside a request (headers() throws) writes no lane and does not fail', async () => {
    (headers as Mock).mockRejectedValue(new Error('outside a request scope'));
    expect((await post({ content: 'hi' })).status).toBe(201);
    expect(create.mock.calls[0][0].data).not.toHaveProperty('actor_lane');
  });
});
