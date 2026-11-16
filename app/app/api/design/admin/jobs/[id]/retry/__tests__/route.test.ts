import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous } from '@/lib/design/__tests__/route-test-kit';

const JOB = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OTHER = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const TRACK = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const TASK = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: vi.fn() }));
vi.mock('@/lib/work/ask-closure', () => ({ closeAsksForTask: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const tx = {
    $executeRaw: vi.fn(),
    designJob: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    designTrack: { findUnique: vi.fn() },
    task: { findUnique: vi.fn(), update: vi.fn() },
    comment: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return { prisma: { user: { findUnique: vi.fn() }, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)), __tx: tx } };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const tx = (prisma as unknown as { __tx: Record<string, Record<string, Mock>> }).__tx;
const call = (id = JOB, headers?: Record<string, string>) => POST(jsonRequest(`/api/design/admin/jobs/${id}/retry`, 'POST', {}, headers), paramsOf({ id }));

const failedJob = { id: JOB, track_id: TRACK, kind: 'provision', status: 'failed', task_id: TASK, attempts: 2, error: 'ImportError: x', payload: {}, result: null, not_before: null, claimed_by: 'r1', lease_until: null, command_id: null, cost_usd: null, log_asset_id: null, started_at: null, finished_at: new Date(), created_at: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  tx.designJob.findUnique.mockResolvedValue(failedJob);
  tx.designTrack.findUnique.mockResolvedValue({ id: TRACK, stage: 'research' });
  tx.designJob.findFirst.mockResolvedValue(null);
  tx.designJob.updateMany.mockResolvedValue({ count: 1 });
  tx.designJob.findUniqueOrThrow.mockResolvedValue({ ...failedJob, status: 'queued', attempts: 0, claimed_by: null, finished_at: null });
  tx.task.findUnique.mockResolvedValue({ tags: ['design-job:provision', 'needs-mike'] });
  tx.user.findUnique.mockResolvedValue({ name: 'Mike Dion' });
});

describe('POST /api/design/admin/jobs/:id/retry', () => {
  it('puts a failed job back in the queue, resets attempts, keeps the error, drops needs-mike and notes it', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).toMatchObject({ id: JOB, status: 'queued', attempts: 0, claimed_by: null, error: 'ImportError: x' });
    const upd = tx.designJob.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: JOB, status: 'failed' });
    expect(upd.data).toEqual({ status: 'queued', attempts: 0, claimed_by: null, lease_until: null, finished_at: null, not_before: null });
    expect(upd.data).not.toHaveProperty('error');
    expect(tx.task.update.mock.calls[0][0].data.tags).toEqual(['design-job:provision']);
    const comment = tx.comment.create.mock.calls[0][0].data;
    expect(comment).toMatchObject({ task_id: TASK, is_internal: true });
    expect(comment.content).toBe('The provision job was put back in the queue by Mike Dion after the cause was fixed.');
  });
  it('works for a job with no task', async () => {
    tx.designJob.findUnique.mockResolvedValue({ ...failedJob, task_id: null });
    expect((await call()).status).toBe(200);
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(tx.comment.create).not.toHaveBeenCalled();
  });
  it('409 not_failed for a job that is not failed, and writes nothing', async () => {
    for (const status of ['queued', 'claimed', 'running', 'done']) {
      tx.designJob.findUnique.mockResolvedValue({ ...failedJob, status });
      const res = await call();
      expect(res.status, status).toBe(409);
      expect((await res.json()).code).toBe('not_failed');
    }
    expect(tx.designJob.updateMany).not.toHaveBeenCalled();
  });
  it('409 when the track is done or cancelled', async () => {
    for (const stage of ['done', 'cancelled']) {
      tx.designTrack.findUnique.mockResolvedValue({ id: TRACK, stage });
      expect((await call()).status, stage).toBe(409);
    }
    expect(tx.designJob.updateMany).not.toHaveBeenCalled();
  });
  it('409 when another job of the same kind is already active on the track', async () => {
    tx.designJob.findFirst.mockResolvedValue({ id: OTHER });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already_active');
    expect(tx.designJob.findFirst.mock.calls[0][0].where).toMatchObject({ track_id: TRACK, kind: 'provision', status: { in: ['queued', 'claimed', 'running'] } });
    expect(tx.designJob.updateMany).not.toHaveBeenCalled();
  });
  it('409 when the compare and set loses a race', async () => {
    tx.designJob.updateMany.mockResolvedValue({ count: 0 });
    expect((await call()).status).toBe(409);
    expect(tx.comment.create).not.toHaveBeenCalled();
  });
  it('404 for an unknown or malformed job', async () => {
    tx.designJob.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
  });
  it('cross-site 403; anonymous 401; designer, pm and a plain API key 403; nothing written', async () => {
    expect((await call(JOB, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await call()).status).toBe(401);
    for (const role of ['designer', 'pm'] as const) { signIn(auth, userFind, role); expect((await call()).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call()).status).toBe(403);
    expect(tx.designJob.updateMany).not.toHaveBeenCalled();
  });
});
