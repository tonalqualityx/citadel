import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// A review is a CARD, not a flag (Mike, 2026-11-18). Three rules at the PATCH layer: a review card cannot be given needs_review,
// an ordinary shipped task closes without it (the default: no stamp), and a task given it with a stated reason keeps it.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    emailAsk: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatTaskResponse: vi.fn((task) => ({ ...task, time_spent_minutes: null })),
}));

vi.mock('@/lib/services/activity', () => ({
  logStatusChange: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock('@/lib/services/notifications', () => ({
  notifyTaskAssigned: vi.fn(),
}));

vi.mock('@/lib/services/dependencies', () => ({
  unblockEligibleDependents: vi.fn(),
  reblockDependents: vi.fn(),
  areBlockersSatisfied: vi.fn(async () => true),
  wouldCreateCycle: vi.fn(async () => false),
}));

vi.mock('@/lib/calculations/energy', () => ({
  calculateEstimatedMinutes: vi.fn((energy: number) => energy * 30),
}));

// Work stage A: the closure of a finished task's emails has its own tests (lib/work); here it is a stub so the nudge lookups stay countable.
vi.mock('@/lib/work/ask-closure', () => ({ closeAsksForTask: vi.fn(async () => ({ closed: [], action_ids: [], held: { security: [], undone: [] } })) }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logStatusChange } from '@/lib/services/activity';
import {
  unblockEligibleDependents,
  reblockDependents,
  areBlockersSatisfied,
} from '@/lib/services/dependencies';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockEmailAskFindFirst = prisma.emailAsk.findFirst as Mock;

const TASK_ID = 'task-1';
const BLOCKER_ID = '550e8400-e29b-41d4-a716-446655440020';

function makeRequest(body: object) {
  return new NextRequest(`http://localhost/api/tasks/${TASK_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: TASK_ID });

function existingTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: 'A task',
    status: 'in_progress',
    project_id: null,
    project: null,
    assignee_id: null,
    function_id: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    estimated_minutes: null,
    created_by_id: 'user-1',
    started_at: new Date('2026-10-01T00:00:00.000Z'),
    arc_id: null,
    source: 'internal',
    is_deleted: false,
    ...overrides,
  };
}

// The mocked update echoes back the existing row merged with what the route wrote.
function echoUpdate(existing: Record<string, unknown>) {
  mockTaskUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...existing,
    ...data,
    assignee: null,
    reviewer: null,
    approved_by: null,
    function: null,
    sop: null,
    created_by: null,
    blocked_by: [],
    blocking: [],
  }));
}

function given(overrides: Record<string, unknown> = {}) {
  const existing = existingTask(overrides);
  mockTaskFindUnique.mockResolvedValue(existing);
  echoUpdate(existing);
  return existing;
}

const updateData = () => mockTaskUpdate.mock.calls[0][0].data;

describe('PATCH /api/tasks/[id] - a review is a card, not a flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'pm@test.com', role: 'pm' });
    mockEmailAskFindFirst.mockResolvedValue(null);
    vi.mocked(areBlockersSatisfied).mockResolvedValue(true);
  });

  const call = (body: object) => PATCH(makeRequest(body), { params: makeParams() });

  it.each(['review-card', 'review', 'client-review', 'design-stage:review'])('refuses needs_review: true on a task tagged %s', async (tag) => {
    given({ tags: [tag], status: 'done' });
    const res = await call({ needs_review: true });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('review_card_no_stamp');
    expect(json.error).toMatch(/review card cannot carry needs_review/);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('refuses tagging a stamped task as a review card, and a combined stamp + review tag', async () => {
    given({ tags: [], needs_review: true });
    expect((await call({ tags: ['review-card'] })).status).toBe(422);
    given({ tags: [] });
    expect((await call({ tags: ['review-card'], needs_review: true })).status).toBe(422);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('lets a review card clear a stamp it already had, and be edited without touching the stamp', async () => {
    given({ tags: ['review-card'], needs_review: true });
    expect((await call({ needs_review: false })).status).toBe(200);
    expect(updateData().needs_review).toBe(false);
    vi.clearAllMocks();
    given({ tags: ['review-card'], needs_review: true });
    expect((await call({ title: 'Reword' })).status).toBe(200);
  });

  it('closes an ordinary shipped task without needs_review (the default)', async () => {
    given({ tags: ['bast-doable'], needs_review: false });
    const res = await call({ status: 'done' });
    expect(res.status).toBe(200);
    expect(mockTaskUpdate.mock.calls[0][0].data.needs_review).toBeUndefined();
    expect((await res.json()).needs_review).toBe(false);
  });

  it('keeps needs_review on an ordinary task given it with a stated reason', async () => {
    given({ tags: ['client-approval'], status: 'done' });
    const res = await call({ needs_review: true });
    expect(res.status).toBe(200);
    expect(updateData().needs_review).toBe(true);
  });
});
