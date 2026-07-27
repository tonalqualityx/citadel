import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

// Clarity Phase 7 — GET /api/arcs/{id}/context: the session-briefing endpoint. A Claude
// Code session declaring this arc reads this one call for everything the arc touches.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    emailAsk: {
      findMany: vi.fn(),
    },
    oracleSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskFindFirst = prisma.task.findFirst as Mock;
const mockEmailAskFindMany = prisma.emailAsk.findMany as Mock;
const mockSessionFindMany = prisma.oracleSession.findMany as Mock;
const mockSessionFindFirst = prisma.oracleSession.findFirst as Mock;

function arc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Herba proposal round',
    description: null,
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    accord_id: null,
    accord: null,
    origin_session_external_id: null,
    closed_at: null,
    snoozed_until: null,
    next_touch: null,
    cover_url: null,
    estimate_override_minutes: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-20T00:00:00.000Z'),
    tasks: [],
    ...overrides,
  };
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs/arc-1/context');
}

const params = Promise.resolve({ id: 'arc-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
  mockTaskFindMany.mockResolvedValue([]);
  mockTaskFindFirst.mockResolvedValue(null);
  mockEmailAskFindMany.mockResolvedValue([]);
  mockSessionFindMany.mockResolvedValue([]);
  mockSessionFindFirst.mockResolvedValue(null);
  mockArcFindMany.mockResolvedValue([]);
});

describe('GET /api/arcs/[id]/context', () => {
  it('404s when the arc does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Arc not found');
  });

  it('returns arc core fields, client, and project', async () => {
    mockArcFindUnique.mockResolvedValue(
      arc({
        client: { id: 'client-1', name: 'Herba' },
        project: { id: 'project-1', name: 'Website rebuild', status: 'in_progress' },
        next_touch: new Date('2026-08-01T00:00:00.000Z'),
      })
    );

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.arc.id).toBe('arc-1');
    expect(body.arc.name).toBe('Herba proposal round');
    expect(body.arc.next_touch).toBe(new Date('2026-08-01T00:00:00.000Z').toISOString());
    expect(body.client).toEqual({ id: 'client-1', name: 'Herba' });
    expect(body.project).toEqual({ id: 'project-1', name: 'Website rebuild', status: 'in_progress' });
    expect(body.next_touch).toBe(new Date('2026-08-01T00:00:00.000Z').toISOString());
  });

  it('returns the accord summary with sibling arcs on the same accord (the "earlier rounds" hook)', async () => {
    mockArcFindUnique.mockResolvedValue(
      arc({
        accord_id: 'accord-1',
        accord: {
          id: 'accord-1',
          name: 'Herba pipeline',
          status: 'proposal',
          lead_name: 'Jane Doe',
          lead_business_name: 'Herba Co',
          lead_email: 'jane@herba.com',
          lead_phone: null,
        },
      })
    );
    mockArcFindMany.mockResolvedValue([
      { id: 'arc-report', name: 'Discovery report round', closed_at: new Date('2026-06-01T00:00:00.000Z') },
      { id: 'arc-kickoff', name: 'Kickoff round', closed_at: null },
    ]);

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.accord).toMatchObject({
      id: 'accord-1',
      name: 'Herba pipeline',
      status: 'proposal',
      lead_name: 'Jane Doe',
      lead_business_name: 'Herba Co',
      lead_email: 'jane@herba.com',
      lead_phone: null,
    });
    expect(body.accord.other_arcs).toEqual([
      { id: 'arc-report', name: 'Discovery report round', closed_at: new Date('2026-06-01T00:00:00.000Z').toISOString() },
      { id: 'arc-kickoff', name: 'Kickoff round', closed_at: null },
    ]);
    expect(mockArcFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accord_id: 'accord-1', id: { not: 'arc-1' } } })
    );
  });

  it('accord is null and other_arcs is never queried when the arc has no accord', async () => {
    mockArcFindUnique.mockResolvedValue(arc());

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.accord).toBeNull();
    expect(mockArcFindMany).not.toHaveBeenCalled();
  });

  it('splits tasks into open and recent (done/abandoned)', async () => {
    mockArcFindUnique.mockResolvedValue(arc());
    mockTaskFindMany
      .mockResolvedValueOnce([
        { id: 't-open-1', title: 'Open task', status: 'in_progress', priority: 1, due_date: null },
      ])
      .mockResolvedValueOnce([
        { id: 't-done-1', title: 'Done task', status: 'done', priority: 3, due_date: null, updated_at: new Date('2026-07-15T00:00:00.000Z') },
      ]);

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.tasks.open).toHaveLength(1);
    expect(body.tasks.open[0].id).toBe('t-open-1');
    expect(body.tasks.recent).toHaveLength(1);
    expect(body.tasks.recent[0].id).toBe('t-done-1');

    // Open query excludes done/abandoned, recent query is scoped to them.
    expect(mockTaskFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ['done', 'abandoned'] } }) })
    );
    expect(mockTaskFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['done', 'abandoned'] } }) })
    );
  });

  it('returns attached emails (subject/gist/deep_link)', async () => {
    mockArcFindUnique.mockResolvedValue(arc());
    mockEmailAskFindMany.mockResolvedValue([
      {
        id: 'ask-1',
        subject: 'Re: proposal',
        gist: 'Wants a call this week',
        deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
        received_at: new Date('2026-07-19T00:00:00.000Z'),
      },
    ]);

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.emails).toHaveLength(1);
    expect(body.emails[0]).toMatchObject({ id: 'ask-1', subject: 'Re: proposal', gist: 'Wants a call this week', deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1' });
    expect(mockEmailAskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { arc_id: 'arc-1' } })
    );
  });

  it('returns linked sessions (title/status/goal/waiting_on)', async () => {
    mockArcFindUnique.mockResolvedValue(arc());
    mockSessionFindMany.mockResolvedValue([
      { external_id: 'sess-1', title: 'Build session', status: 'running', goal: 'Ship phase 1', waiting_on: null, last_event_at: new Date('2026-07-20T10:00:00.000Z') },
    ]);

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.sessions).toEqual([
      { external_id: 'sess-1', title: 'Build session', status: 'running', goal: 'Ship phase 1', waiting_on: null, last_event_at: new Date('2026-07-20T10:00:00.000Z').toISOString() },
    ]);
  });

  it('merges in the origin session when it is not already among the arc_id-linked set', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ origin_session_external_id: 'ext-origin' }));
    mockSessionFindMany.mockResolvedValue([]);
    mockSessionFindFirst.mockResolvedValue({
      external_id: 'ext-origin',
      title: 'Origin session',
      status: 'idle',
      goal: null,
      waiting_on: null,
      last_event_at: null,
    });

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { external_id: 'ext-origin' } })
    );
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].external_id).toBe('ext-origin');
  });

  it('does not re-query the origin session when already among the linked set', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ origin_session_external_id: 'ext-shared' }));
    mockSessionFindMany.mockResolvedValue([
      { external_id: 'ext-shared', title: 'Shared', status: 'waiting', goal: null, waiting_on: 'Need a decision', last_event_at: new Date() },
    ]);

    const res = await GET(getRequest(), { params });

    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect((await res.json()).sessions).toHaveLength(1);
  });

  it('computes recent activity timestamps', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ updated_at: new Date('2026-07-20T00:00:00.000Z') }));
    mockTaskFindFirst.mockResolvedValue({ updated_at: new Date('2026-07-18T00:00:00.000Z') });
    mockEmailAskFindMany.mockResolvedValue([
      { id: 'ask-1', subject: 'X', gist: null, deep_link: 'https://x', received_at: new Date('2026-07-19T00:00:00.000Z') },
    ]);
    mockSessionFindMany.mockResolvedValue([
      { external_id: 's1', title: null, status: 'waiting', goal: null, waiting_on: null, last_event_at: new Date('2026-07-21T00:00:00.000Z') },
    ]);

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.activity).toEqual({
      last_task_activity_at: new Date('2026-07-18T00:00:00.000Z').toISOString(),
      last_email_received_at: new Date('2026-07-19T00:00:00.000Z').toISOString(),
      last_session_activity_at: new Date('2026-07-21T00:00:00.000Z').toISOString(),
      arc_updated_at: new Date('2026-07-20T00:00:00.000Z').toISOString(),
    });
  });

  it('activity timestamps are all null when there is no task/email/session activity', async () => {
    mockArcFindUnique.mockResolvedValue(arc());

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.activity.last_task_activity_at).toBeNull();
    expect(body.activity.last_email_received_at).toBeNull();
    expect(body.activity.last_session_activity_at).toBeNull();
  });
});
