// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn().mockResolvedValue('America/New_York') }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { userPreference: { findUnique: vi.fn() } } }));
vi.mock('@/lib/home/reconcile/load', async (orig) => ({ ...(await orig<typeof import('@/lib/home/reconcile/load')>()), reconcileOn: vi.fn() }));
vi.mock('@/lib/home/reconcile/apply', async (orig) => ({ ...(await orig<typeof import('@/lib/home/reconcile/apply')>()), proposalYes: vi.fn(), logTime: vi.fn() }));
vi.mock('@/lib/home/reconcile/track', () => ({ trackIt: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { reconcileOn } from '@/lib/home/reconcile/load';
import { logTime, proposalYes } from '@/lib/home/reconcile/apply';
import { trackIt } from '@/lib/home/reconcile/track';
import { POST } from '../route';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const MIKE = '11111111-1111-4111-8111-111111111111';
const KEY = 'proposal:7aa4a01a-1111-4222-8333-944445555666';
const track = { action: 'track_it', item_key: KEY, placement: 'new_project', minutes: 90, billable: true };
const result = { ok: true, action_id: 'a1', undo_until: '2026-11-12T00:00:00Z', item_key: KEY, message: 'Tracked: 4 tasks.' };
const req = (body: unknown, raw = false) =>
  new NextRequest('http://localhost:3000/api/home/reconcile', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
function signIn(over: Record<string, unknown> = {}, homeView: string | null = 'home') {
  mockAuth.mockResolvedValue({ userId: MIKE, email: 'm@x.test', role: 'admin', via: 'session', ...over } as never);
  mockPref.mockResolvedValue(homeView === null ? null : { home_view: homeView });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reconcileOn).mockResolvedValue(true);
  vi.mocked(trackIt).mockResolvedValue(result as never);
  vi.mocked(logTime).mockResolvedValue(result as never);
  vi.mocked(proposalYes).mockResolvedValue(result as never);
});

describe('POST /api/home/reconcile: the only door that can create a time entry', () => {
  it('401 without a login', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await POST(req(track))).status).toBe(401);
    expect(trackIt).not.toHaveBeenCalled();
  });

  it('403 for any API key (the chat key, the courier key, the machine job), whatever its role', async () => {
    for (const role of ['admin', 'pm', 'tech']) {
      signIn({ via: 'api_key', role });
      for (const body of [track, { action: 'log_time', task_id: MIKE, minutes: 30, day: '2026-11-10' }, { action: 'proposal_yes', item_key: KEY, minutes: 30 }]) {
        expect((await POST(req(body))).status).toBe(403);
      }
    }
    expect(trackIt).not.toHaveBeenCalled();
    expect(logTime).not.toHaveBeenCalled();
    expect(proposalYes).not.toHaveBeenCalled();
  });

  it('403 for a session that is not an admin, or whose home screen is off', async () => {
    signIn({ role: 'pm' });
    expect((await POST(req(track))).status).toBe(403);
    signIn({}, 'classic');
    expect((await POST(req(track))).status).toBe(403);
    expect(trackIt).not.toHaveBeenCalled();
  });

  it('runs each action for the signed-in user with his own zone, and answers no-store', async () => {
    signIn();
    let res = await POST(req(track));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(vi.mocked(trackIt).mock.calls[0].slice(1, 4)).toEqual([MIKE, KEY, { placement: 'new_project', minutes: 90, billable: true }]);
    expect(vi.mocked(trackIt).mock.calls[0][4]).toMatchObject({ timezone: 'America/New_York' });
    res = await POST(req({ action: 'log_time', task_id: '7aa4a01a-1111-4222-8333-944445555666', minutes: 30, day: '2026-11-10' }));
    expect(res.status).toBe(200);
    expect(vi.mocked(logTime).mock.calls[0][1]).toBe(MIKE);
    res = await POST(req({ action: 'proposal_yes', item_key: KEY, minutes: 45 }));
    expect(res.status).toBe(200);
    expect(vi.mocked(proposalYes).mock.calls[0][3]).toMatchObject({ allowTime: true, minutes: 45 });
  });

  it('is strict: a user id, an unknown placement, a bad minutes or a non-JSON body is 400', async () => {
    signIn();
    for (const bad of [{ ...track, user_id: MIKE }, { ...track, placement: 'elsewhere' }, { ...track, minutes: -5 }, { action: 'log_time', task_id: 'nope', minutes: 30, day: '2026-11-10' }, { action: 'something_else' }]) {
      expect((await POST(req(bad))).status).toBe(400);
    }
    expect((await POST(req('{nope', true))).status).toBe(400);
    expect(trackIt).not.toHaveBeenCalled();
  });

  it('409 while the sent-mail switch is off; nothing runs', async () => {
    signIn();
    vi.mocked(reconcileOn).mockResolvedValue(false);
    expect((await POST(req(track))).status).toBe(409);
    expect(trackIt).not.toHaveBeenCalled();
  });
});
