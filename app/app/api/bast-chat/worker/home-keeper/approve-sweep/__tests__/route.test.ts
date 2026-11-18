// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../../__tests__/harness';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/bast-chat/route-helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/route-helpers')>()),
  workerOwnerId: vi.fn(async () => OWNER_ID),
}));
vi.mock('@/lib/home/keeper/approve-sweep', () => ({ runApproveSweep: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { runApproveSweep } from '@/lib/home/keeper/approve-sweep';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { GET, POST } from '../route';

const PATH = '/api/bast-chat/worker/home-keeper/approve-sweep';
const result = (dry: boolean) => ({ dry_run: dry, approved: [], raced: 0, skipped: { security: 0, too_recent: 0, not_bot_assignee: 0, human_comment: 0, client_facing: 0, client_name: 0 }, names_compared: 0, line: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(runApproveSweep).mockImplementation((async (_d: unknown, _o: unknown, _n: unknown, o: { dryRun: boolean }) => result(o.dryRun)) as never);
});

describe('approve-sweep route', () => {
  it('GET is a dry run', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).dry_run).toBe(true);
    expect(vi.mocked(runApproveSweep).mock.calls[0][3]).toEqual({ dryRun: true });
  });
  it('POST with {} is the real run', async () => {
    const res = await POST(req('POST', PATH, {}));
    expect(res.status).toBe(200);
    expect((await res.json()).dry_run).toBe(false);
    expect(vi.mocked(runApproveSweep).mock.calls[0][3]).toEqual({ dryRun: false });
  });
  it('POST refuses a body with fields', async () => {
    const res = await POST(req('POST', PATH, { dry_run: false }));
    expect(res.status).toBe(400);
    expect(runApproveSweep).not.toHaveBeenCalled();
  });
  it.each(NOT_WORKERS)('refuses %s', async (_n, auth) => {
    vi.mocked(requireAuth).mockResolvedValue(auth);
    expect((await GET()).status).toBeGreaterThanOrEqual(401);
    expect(runApproveSweep).not.toHaveBeenCalled();
  });
  it('is on the lane allowlist for both methods', () => {
    const s = JSON.stringify(LANE_ROUTES['bast-chat']);
    expect(s).toContain('approve-sweep');
  });
});
