// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, WORKER, req } from '../../../__tests__/harness';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/work/finished-store', async (orig) => ({ ...(await orig<typeof import('@/lib/work/finished-store')>()), runSweep: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { runSweep } from '@/lib/work/finished-store';
import { POST } from '../route';

const PATH = '/api/bast-chat/worker/finished';
const TASK = '11111111-1111-4111-8111-111111111111';
const result = { dry: true, total: 0, counts: {}, others: [], sample: [], created: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(runSweep).mockResolvedValue(result as never);
});

describe('finished route', () => {
  it('401 when signed out and runs nothing', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req('POST', PATH, { dry: true }) as never)).status).toBe(401);
    expect(runSweep).not.toHaveBeenCalled();
  });
  for (const [who, auth] of NOT_WORKERS) {
    it(`403 for ${who}`, async () => {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await POST(req('POST', PATH, { dry: true }) as never)).status).toBe(403);
      expect(runSweep).not.toHaveBeenCalled();
    });
  }
  it('runs the sweep as asked, with the machine evidence', async () => {
    const body = { dry: true, machine_evidence: [{ task_id: TASK, kind: 'worker_done', ref: 'run-1', at: '2026-11-10T12:00:00Z' }] };
    const res = await POST(req('POST', PATH, body) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(vi.mocked(runSweep).mock.calls[0][1]).toEqual(body);
  });
  it('machine evidence defaults to none', async () => {
    await POST(req('POST', PATH, { dry: false }) as never);
    expect(vi.mocked(runSweep).mock.calls[0][1]).toEqual({ dry: false, machine_evidence: [] });
  });
  it('400 on a missing dry, an extra field (a user id), a bad kind or a bad task id', async () => {
    for (const body of [{}, { dry: true, user_id: TASK }, { dry: true, machine_evidence: [{ task_id: TASK, kind: 'deploy', ref: 'x', at: '2026-11-10T12:00:00Z' }] }, { dry: true, machine_evidence: [{ task_id: 'nope', kind: 'commit', ref: 'x', at: '2026-11-10T12:00:00Z' }] }]) {
      expect((await POST(req('POST', PATH, body) as never)).status).toBe(400);
    }
    expect(runSweep).not.toHaveBeenCalled();
  });
});
