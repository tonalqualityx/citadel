import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/work/state', async (orig) => ({ ...(await orig<typeof import('@/lib/work/state')>()), workState: vi.fn() }));

import { GET } from '../route';
import { GET as taskAliasGet } from '../../../task/[id]/state/route';
import { requireAuth } from '@/lib/auth/middleware';
import { workState } from '@/lib/work/state';

const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const call = (key: string) => GET(new NextRequest(`http://localhost:3000/api/work/${key}/state`), { params: Promise.resolve({ key }) });
const lane = (l: string) => ({ userId: 'bast', role: 'pm', email: 'b@x.test', via: 'api_key', apiKeyId: 'k', lane: l });
const report = { target_key: `task:${T}`, type: 'task', id: T, name: 'N', href: `/tasks/${T}`, status: 'in_progress', state: 'with_bast', since: null, line: 'With Bast', attached: [], evidence: [], live_session: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(lane('bast') as never);
  vi.mocked(workState).mockResolvedValue(report as never);
});

describe('GET /api/work/:target_key/state', () => {
  it('answers the owner and the bast, oracle, bast-chat and porter lanes; refuses every other lane and a non-admin session', async () => {
    for (const l of ['bast', 'oracle', 'bast-chat', 'porter']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await call(`task:${T}`)).status).toBe(200);
    }
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a', role: 'admin', email: 'a@x.test', via: 'session' } as never);
    expect((await call(`project:${T}`)).status).toBe(200);
    for (const l of ['wright', 'courier', 'clarity']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await call(`task:${T}`)).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u', role: 'tech', email: 'u@x.test', via: 'session' } as never);
    expect((await call(`task:${T}`)).status).toBe(403);
  });

  it('400 for a key that is not a target, 404 when the work does not exist', async () => {
    expect((await call('nope')).status).toBe(400);
    expect((await call('proposed')).status).toBe(400);
    vi.mocked(workState).mockResolvedValue(null);
    expect((await call(`task:${T}`)).status).toBe(404);
  });

  it('accepts the key URL-encoded, and the worker path /api/work/task/:id/state is the same answer', async () => {
    expect((await call(encodeURIComponent(`task:${T}`))).status).toBe(200);
    expect(vi.mocked(workState).mock.calls[0][1]).toBe(`task:${T}`);
    const alias = await taskAliasGet(new NextRequest(`http://localhost:3000/api/work/task/${T}/state`), { params: Promise.resolve({ id: T }) });
    expect(alias.status).toBe(200);
    expect((await alias.json()).target_key).toBe(`task:${T}`);
  });
});
