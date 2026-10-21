import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// Portal phase B slice 1: a PATCH that moves a portal request off not_started (or stages it)
// calls onTaskProgress so its first-response clock resolves. Best effort, portal tasks only.
// Mocking pattern mirrors completion-nudge.test.ts in this directory.

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findUnique: vi.fn(), update: vi.fn() }, emailAsk: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/api/formatters', () => ({ formatTaskResponse: vi.fn((task) => ({ ...task, time_spent_minutes: null })) }));
vi.mock('@/lib/services/activity', () => ({ logStatusChange: vi.fn(), logUpdate: vi.fn(), logDelete: vi.fn() }));
vi.mock('@/lib/services/notifications', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@/lib/calculations/status', () => ({ canTransitionTaskStatus: vi.fn(() => true) }));
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: vi.fn(), reblockDependents: vi.fn() }));
vi.mock('@/lib/portal/waits', () => ({ onTaskProgress: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { onTaskProgress } from '@/lib/portal/waits';

const mockFind = prisma.task.findUnique as Mock;
const mockUpdate = prisma.task.update as Mock;
const mockProgress = onTaskProgress as Mock;

const req = (body: object) => new NextRequest('http://localhost/api/tasks/task-1', { method: 'PATCH', body: JSON.stringify(body) });
const params = () => Promise.resolve({ id: 'task-1' });

const base = {
  id: 'task-1',
  title: 'A task',
  project: null,
  assignee: null,
  assignee_id: null,
  reviewer: null,
  approved_by: null,
  function: null,
  sop: null,
  created_by: null,
  blocked_by: [],
  blocking: [],
  arc_id: null,
  arc: null,
  staging_preview_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'user-1', email: 't@t.com', role: 'pm' });
  mockFind.mockResolvedValue({ ...base, status: 'not_started', project: null, is_deleted: false, started_at: null, source: 'portal' });
});

describe('PATCH /api/tasks/[id] portal first-response hook', () => {
  it('calls onTaskProgress after a status-only change on a portal task', async () => {
    mockUpdate.mockResolvedValue({ ...base, status: 'in_progress', source: 'portal' });
    const res = await PATCH(req({ status: 'in_progress' }), { params: params() });
    expect(res.status).toBe(200);
    expect(mockProgress).toHaveBeenCalledTimes(1);
    expect(mockProgress.mock.calls[0][1]).toMatchObject({ id: 'task-1', status: 'in_progress' });
  });

  it('calls it after a regular update that stages the task', async () => {
    mockUpdate.mockResolvedValue({ ...base, status: 'review', source: 'portal', staging_preview_url: 'https://staging.example.com' });
    const res = await PATCH(req({ staging_preview_url: 'https://staging.example.com' }), { params: params() });
    expect(res.status).toBe(200);
    expect(mockProgress).toHaveBeenCalledTimes(1);
    expect(mockProgress.mock.calls[0][1]).toMatchObject({ staging_preview_url: 'https://staging.example.com' });
  });

  it('skips tasks that did not come from the portal', async () => {
    mockUpdate.mockResolvedValue({ ...base, status: 'in_progress', source: 'internal' });
    await PATCH(req({ status: 'in_progress' }), { params: params() });
    expect(mockProgress).not.toHaveBeenCalled();
  });

  it('never fails the update when the wait write throws', async () => {
    mockUpdate.mockResolvedValue({ ...base, status: 'in_progress', source: 'portal' });
    mockProgress.mockRejectedValue(new Error('db down'));
    const res = await PATCH(req({ status: 'in_progress' }), { params: params() });
    expect(res.status).toBe(200);
  });
});
