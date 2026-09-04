import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    comment: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
    emailAsk: { findMany: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
    blockerDismissal: { findMany: vi.fn() },
    clientContact: { findMany: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    arc: { findMany: vi.fn() },
    oracleSession: { findMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindMany = prisma.project.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockCommentFindMany = prisma.comment.findMany as Mock;
const mockTimeEntryFindMany = prisma.timeEntry.findMany as Mock;
const mockActivityLogFindMany = prisma.activityLog.findMany as Mock;
const mockEmailAskFindMany = prisma.emailAsk.findMany as Mock;
const mockApprovalRequestFindMany = prisma.approvalRequest.findMany as Mock;
const mockBlockerDismissalFindMany = prisma.blockerDismissal.findMany as Mock;
const mockClientContactFindMany = prisma.clientContact.findMany as Mock;
const mockCalendarEventFindMany = prisma.calendarEvent.findMany as Mock;
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockOracleSessionFindMany = prisma.oracleSession.findMany as Mock;

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    name: 'Herba rebuild',
    client: { id: 'client-1', name: 'Herba' },
    status: 'in_progress',
    next_step_text: null,
    next_step_owner: null,
    next_step_source: null,
    next_step_at: null,
    stale_muted_until: null,
    ...overrides,
  };
}

function getReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindMany.mockResolvedValue([]);
  mockTaskFindMany.mockResolvedValue([]);
  mockCommentFindMany.mockResolvedValue([]);
  mockTimeEntryFindMany.mockResolvedValue([]);
  mockActivityLogFindMany.mockResolvedValue([]);
  mockEmailAskFindMany.mockResolvedValue([]);
  mockApprovalRequestFindMany.mockResolvedValue([]);
  mockBlockerDismissalFindMany.mockResolvedValue([]);
  mockClientContactFindMany.mockResolvedValue([]);
  mockCalendarEventFindMany.mockResolvedValue([]);
  mockArcFindMany.mockResolvedValue([]);
  mockOracleSessionFindMany.mockResolvedValue([]);
});

describe('GET /api/oracle/projects — auth', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/oracle/projects — filter', () => {
  it('queries only type=project, status=in_progress, is_deleted=false', async () => {
    await GET(getReq());
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'project', status: 'in_progress', is_deleted: false },
      })
    );
  });

  it('returns an empty list with stalled_count 0 when nothing is in progress', async () => {
    mockProjectFindMany.mockResolvedValue([]);
    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.projects).toEqual([]);
    expect(body.stalled_count).toBe(0);
    expect(body.generated_at).toBeTruthy();
  });
});

describe('GET /api/oracle/projects — stalled sort', () => {
  it('sorts stalled-on-Mike projects before non-stalled ones', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'quiet', name: 'Quiet Project', client: { id: 'client-quiet', name: 'Quiet Co' } }),
      project({ id: 'stalled', name: 'Stalled Project', client: { id: 'client-stalled', name: 'Stalled Co' } }),
    ]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-stalled',
        title: 'Needs review',
        status: 'done',
        tags: [],
        needs_review: true,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: new Date('2026-09-09T00:00:00.000Z'),
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        project_id: 'stalled',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    // Recent movement on the quiet project so it doesn't ALSO pick up a "stale" blocker
    // (which would itself be owned by Mike) — this test is isolating the review-blocker
    // signal specifically.
    mockTimeEntryFindMany.mockResolvedValue([
      { project_id: 'quiet', task_id: null, user_id: 'u1', user: { name: 'Alex' }, started_at: new Date() },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual(['stalled', 'quiet']);
    expect(body.stalled_count).toBe(1);
    expect(body.projects[0].stalled_on_mike).toBe(true);
    expect(body.projects[1].stalled_on_mike).toBe(false);
  });

  it('within the same stalled bucket, sorts by days_quiet descending', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'less-quiet', name: 'Less Quiet', client: { id: 'client-a', name: 'A' } }),
      project({ id: 'more-quiet', name: 'More Quiet', client: { id: 'client-b', name: 'B' } }),
    ]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-a',
        title: 'Needs review A',
        status: 'done',
        tags: [],
        needs_review: true,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: new Date('2026-09-09T00:00:00.000Z'),
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        project_id: 'less-quiet',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
      {
        id: 'task-b',
        title: 'Needs review B',
        status: 'done',
        tags: [],
        needs_review: true,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: new Date('2026-09-09T00:00:00.000Z'),
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        project_id: 'more-quiet',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    // Movement signal: a recent time entry for less-quiet, an old one for more-quiet.
    mockTimeEntryFindMany.mockResolvedValue([
      { project_id: 'less-quiet', task_id: null, user_id: 'u1', user: { name: 'Alex' }, started_at: new Date() },
      {
        project_id: 'more-quiet',
        task_id: null,
        user_id: 'u1',
        user: { name: 'Alex' },
        started_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects.map((p: { id: string }) => p.id)).toEqual(['more-quiet', 'less-quiet']);
  });
});

describe('GET /api/oracle/projects — kind grouping (?lens=kind)', () => {
  it('groups blockers by kind across projects when lens=kind', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Needs review',
        status: 'done',
        tags: [],
        needs_review: true,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: new Date('2026-09-09T00:00:00.000Z'),
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        project_id: 'proj-1',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);

    const noLens = await GET(getReq());
    const noLensBody = await noLens.json();
    expect(noLensBody.by_kind).toBeUndefined();

    const withLens = await GET(getReq('?lens=kind'));
    const body = await withLens.json();

    expect(body.by_kind).toBeDefined();
    expect(body.by_kind.review).toHaveLength(1);
    expect(body.by_kind.review[0].project).toEqual({ id: 'proj-1', name: 'Herba rebuild' });
    expect(body.by_kind.review[0].blocker.kind).toBe('review');
  });
});

describe('GET /api/oracle/projects — dismissal suppression', () => {
  it('drops a review blocker whose dismissal marker matches the task\'s current updated_at', async () => {
    const updatedAt = new Date('2026-09-09T00:00:00.000Z');
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Needs review',
        status: 'done',
        tags: [],
        needs_review: true,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: updatedAt,
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        project_id: 'proj-1',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    mockBlockerDismissalFindMany.mockResolvedValue([
      {
        project_id: 'proj-1',
        kind: 'task',
        source_id: 'task-1',
        source_marker: updatedAt.toISOString(),
        dismissed_at: new Date(),
      },
    ]);
    // Recent movement so this project doesn't ALSO pick up an (undismissed) "stale"
    // blocker — this test isolates the review-dismissal signal specifically.
    mockTimeEntryFindMany.mockResolvedValue([
      { project_id: 'proj-1', task_id: null, user_id: 'u1', user: { name: 'Alex' }, started_at: new Date() },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers).toHaveLength(0);
    expect(body.projects[0].stalled_on_mike).toBe(false);
  });
});
