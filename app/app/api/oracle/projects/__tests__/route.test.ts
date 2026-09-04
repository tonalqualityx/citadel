import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { MIKE_USER_ID, BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    comment: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
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
const mockQueryRaw = prisma.$queryRaw as Mock;
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
    next_step_owner_label: null,
    next_step_source: null,
    next_step_at: null,
    next_step_refresh_requested_at: null,
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
  mockQueryRaw.mockResolvedValue([]);
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

// HIGH-2
describe('GET /api/oracle/projects — days_quiet has no lookback window', () => {
  it('reports days_quiet from a 40-day-old activity-log entry, not an older time entry that would win under a 30-day lookback', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([]);
    // A much older time entry — under the removed 30-day lookback, this would have been
    // the ONLY candidate left once the 40-day-old activity-log row got filtered out.
    mockTimeEntryFindMany.mockResolvedValue([
      {
        project_id: 'proj-1',
        task_id: null,
        user_id: 'u1',
        user: { name: 'Alex' },
        started_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      },
    ]);
    mockActivityLogFindMany.mockResolvedValue([
      {
        id: 'log-1',
        user_id: 'u1',
        user: { name: 'Alex' },
        action: 'status_changed',
        entity_type: 'project',
        entity_id: 'proj-1',
        created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        changes: { status: { to: 'in_progress' } },
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].days_quiet).toBe(40);
  });
});

// LOW-12
describe('GET /api/oracle/projects — zero-task project', () => {
  it('returns a valid card with no crash for an in-progress project with zero tasks', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe('proj-1');
    expect(body.projects[0].blockers).toEqual(expect.any(Array));
    expect(body.projects[0].next_step.text).toBe('No ready task: everything is blocked, done, or already in progress');
  });
});

// Judgment call overturned (calendar events)
describe('GET /api/oracle/projects — calendar-event attach requires exactly one eligible project', () => {
  it('does NOT attach a matched event to either project when the client has TWO in-progress projects', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'proj-a', client: { id: 'client-multi', name: 'Multi Co' } }),
      project({ id: 'proj-b', client: { id: 'client-multi', name: 'Multi Co' } }),
    ]);
    mockTaskFindMany.mockResolvedValue([]);
    mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-multi', email: 'contact@multi.com' }]);
    mockCalendarEventFindMany.mockResolvedValue([
      {
        id: 'event-1',
        title: 'Multi Co check-in',
        starts_at: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        attendees: [{ email: 'contact@multi.com' }],
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    for (const p of body.projects) {
      expect(p.blockers.some((b: { kind: string }) => b.kind === 'meeting_risk')).toBe(false);
    }
  });

  it('DOES attach a matched event when the client has exactly ONE in-progress project', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-sole', client: { id: 'client-sole', name: 'Sole Co' } })]);
    mockTaskFindMany.mockResolvedValue([]);
    mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-sole', email: 'contact@sole.com' }]);
    mockCalendarEventFindMany.mockResolvedValue([
      {
        id: 'event-1',
        title: 'Sole Co check-in',
        starts_at: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        attendees: [{ email: 'contact@sole.com' }],
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'meeting_risk')).toBe(true);
  });
});

// MEDIUM-5
describe('GET /api/oracle/projects — session-ask project linking', () => {
  it('links via arc.project_id when set', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', project_id: 'proj-1', client_id: null }]);
    mockOracleSessionFindMany.mockResolvedValue([
      {
        external_id: 'sess-1',
        waiting_on: 'Which CMS?',
        ask_queue: 'decide',
        ask_severity: null,
        last_event_at: new Date(),
        created_at: new Date(),
        arc_id: 'arc-1',
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'session_ask')).toBe(true);
  });

  it('falls back to the arc\'s client scope when arc.project_id is null and the client has exactly one in-progress project', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1', client: { id: 'client-1', name: 'Herba' } })]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', project_id: null, client_id: 'client-1' }]);
    mockOracleSessionFindMany.mockResolvedValue([
      {
        external_id: 'sess-1',
        waiting_on: 'Which CMS?',
        ask_queue: 'decide',
        ask_severity: null,
        last_event_at: new Date(),
        created_at: new Date(),
        arc_id: 'arc-1',
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'session_ask')).toBe(true);
  });

  it('does NOT attach when arc.project_id is null and the client has TWO in-progress projects (ambiguous)', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'proj-a', client: { id: 'client-multi', name: 'Multi Co' } }),
      project({ id: 'proj-b', client: { id: 'client-multi', name: 'Multi Co' } }),
    ]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', project_id: null, client_id: 'client-multi' }]);
    mockOracleSessionFindMany.mockResolvedValue([
      {
        external_id: 'sess-1',
        waiting_on: 'Which CMS?',
        ask_queue: 'decide',
        ask_severity: null,
        last_event_at: new Date(),
        created_at: new Date(),
        arc_id: 'arc-1',
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    for (const p of body.projects) {
      expect(p.blockers.some((b: { kind: string }) => b.kind === 'session_ask')).toBe(false);
    }
  });
});

// LOW-9
describe('GET /api/oracle/projects — days_quiet null sorts as quietest (first), and stale honors the mute', () => {
  it('sorts a project with NO recorded movement (days_quiet null) before one with a finite days_quiet, within the stalled bucket', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'has-movement', name: 'Has Movement', client: { id: 'client-a', name: 'A' } }),
      project({ id: 'no-movement', name: 'No Movement', client: { id: 'client-b', name: 'B' } }),
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
        project_id: 'has-movement',
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
        project_id: 'no-movement',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    // Only has-movement gets a (very old, but present) time entry — no-movement gets
    // NOTHING, so its days_quiet comes back null (Infinity internally).
    mockTimeEntryFindMany.mockResolvedValue([
      {
        project_id: 'has-movement',
        task_id: null,
        user_id: 'u1',
        user: { name: 'Alex' },
        started_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].id).toBe('no-movement');
    expect(body.projects[0].days_quiet).toBeNull();
    expect(body.projects[1].id).toBe('has-movement');
    expect(typeof body.projects[1].days_quiet).toBe('number');
  });

  it('reports stale: false when stale_muted_until is in the future, even with old movement', async () => {
    mockProjectFindMany.mockResolvedValue([
      project({ id: 'proj-1', stale_muted_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }),
    ]);
    mockTaskFindMany.mockResolvedValue([]);
    mockTimeEntryFindMany.mockResolvedValue([
      {
        project_id: 'proj-1',
        task_id: null,
        user_id: 'u1',
        user: { name: 'Alex' },
        started_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].stale).toBe(false);
  });

  it('reports stale: true when there is no mute and movement is old', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([]);
    mockTimeEntryFindMany.mockResolvedValue([
      {
        project_id: 'proj-1',
        task_id: null,
        user_id: 'u1',
        user: { name: 'Alex' },
        started_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].stale).toBe(true);
  });
});

// C1 (Phase 3 carry-over)
describe('GET /api/oracle/projects — arc-less session ask is skipped, not attributed (C1)', () => {
  it('never surfaces a session_ask blocker for a session with no arc_id', async () => {
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([]);
    mockArcFindMany.mockResolvedValue([{ id: 'arc-1', project_id: 'proj-1', client_id: null }]);
    // A session with arc_id: null would never actually come back from the real query
    // (which filters arc_id IN (arcIds)) — this proves the route's own defensive check,
    // not the database filter, documenting the arc-less case rather than hiding it.
    mockOracleSessionFindMany.mockResolvedValue([
      {
        external_id: 'sess-arcless',
        waiting_on: 'Which CMS?',
        ask_queue: 'decide',
        ask_severity: null,
        last_event_at: new Date(),
        created_at: new Date(),
        arc_id: null,
      },
    ]);

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'session_ask')).toBe(false);
  });
});

// C3 (Phase 3 carry-over, verifier LOW-C)
describe('GET /api/oracle/projects — movement sees a human comment even when a later Bast comment is the task\'s last comment (C3)', () => {
  it('reports last_movement from the earlier human comment, not the later Bast one', async () => {
    const humanAt = new Date('2026-08-01T10:00:00.000Z');
    const bastAt = new Date('2026-08-05T10:00:00.000Z');

    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Ship the draft',
        status: 'in_progress',
        tags: [],
        needs_review: false,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: bastAt,
        created_at: humanAt,
        project_id: 'proj-1',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    // The task's LAST comment (via the raw last-comment-per-task query) is Bast's —
    // parked, no coinciding status change, so it never counts for movement on its own.
    mockQueryRaw.mockResolvedValue([
      {
        id: 'c-bast',
        task_id: 'task-1',
        user_id: BAST_USER_ID,
        user_name: 'Bast',
        content: 'Parking this, needs-mike.',
        mentioned_user_ids: [],
        created_at: bastAt,
      },
    ]);
    // The human's EARLIER comment on the same task, only visible via the C3 fix's
    // dedicated 90-day non-bot movement query — pre-fix this row was invisible because
    // the movement feed only ever saw the task's single latest comment.
    mockCommentFindMany.mockImplementation((args: { where?: { user_id?: { notIn?: string[] }; OR?: unknown } }) => {
      if (args?.where?.user_id?.notIn) {
        return Promise.resolve([
          {
            id: 'c-human',
            task_id: 'task-1',
            user_id: 'user-1',
            user: { id: 'user-1', name: 'Alex' },
            content: 'Kicked off the draft.',
            mentioned_user_ids: [],
            created_at: humanAt,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].last_movement).toEqual({ at: humanAt.toISOString(), who: 'Alex', what: 'commented' });
  });
});

// C5 (Phase 3 carry-over)
describe('GET /api/oracle/projects — 90-day mention window boundary (C5)', () => {
  function mentionCommentFake(commentAt: Date) {
    return (args: {
      where?: { created_at?: { gte?: Date }; OR?: unknown; user_id?: { notIn?: string[] } };
    }) => {
      const gte = args?.where?.created_at?.gte;
      const inWindow = !gte || commentAt >= gte;
      if (args?.where?.OR) {
        if (!inWindow) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: 'c-mention',
            task_id: 'task-1',
            user_id: 'user-1',
            user: { id: 'user-1', name: 'Alex' },
            content: '@Mike can you weigh in on this?',
            mentioned_user_ids: [MIKE_USER_ID],
            created_at: commentAt,
          },
        ]);
      }
      // humanMovementComments query — irrelevant to this test, kept empty.
      return Promise.resolve([]);
    };
  }

  it('does NOT produce a mention blocker for a comment mentioning Mike 91 days ago (outside the window)', async () => {
    const commentAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Some task',
        status: 'not_started',
        tags: [],
        needs_review: false,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: commentAt,
        created_at: commentAt,
        project_id: 'proj-1',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    mockCommentFindMany.mockImplementation(mentionCommentFake(commentAt));

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'mention')).toBe(false);
  });

  it('DOES produce a mention blocker for a comment mentioning Mike 89 days ago (inside the window)', async () => {
    const commentAt = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    mockProjectFindMany.mockResolvedValue([project({ id: 'proj-1' })]);
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Some task',
        status: 'not_started',
        tags: [],
        needs_review: false,
        approved: false,
        assignee_id: null,
        assignee: null,
        sop: null,
        updated_at: commentAt,
        created_at: commentAt,
        project_id: 'proj-1',
        sort_order: 0,
        project_phase: null,
        blocked_by: [],
      },
    ]);
    mockCommentFindMany.mockImplementation(mentionCommentFake(commentAt));

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.projects[0].blockers.some((b: { kind: string }) => b.kind === 'mention')).toBe(true);
  });
});
