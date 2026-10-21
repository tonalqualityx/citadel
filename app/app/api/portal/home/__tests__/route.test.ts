import { projectAccessScope, taskAccessWhere } from '@/lib/portal/access';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
    article: { findMany: vi.fn() },
    task: { findMany: vi.fn(), aggregate: vi.fn() },
    project: { findMany: vi.fn() },
    projectPhase: { findMany: vi.fn() },
    resourceLink: { findMany: vi.fn() },
    milestone: { aggregate: vi.fn() },
    site: { findMany: vi.fn() },
    siteStatsSnapshot: { findFirst: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { clientHistoryTaskWhere, clientVisibleTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockClientFindFirst = prisma.client.findFirst as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskAggregate = prisma.task.aggregate as Mock;
const mockProjectFindMany = prisma.project.findMany as Mock;
const mockPhaseFindMany = prisma.projectPhase.findMany as Mock;
const mockLinkFindMany = prisma.resourceLink.findMany as Mock;
const mockMilestoneAggregate = prisma.milestone.aggregate as Mock;
const mockSiteFindMany = prisma.site.findMany as Mock;
const mockSnapshotFindFirst = prisma.siteStatsSnapshot.findFirst as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/home'));
}

function setEmptyDefaults() {
  mockClientFindFirst.mockResolvedValue({ id: 'client-acme', name: 'Acme Co' });
  mockArticleFindMany.mockResolvedValue([]);
  mockTaskFindMany.mockResolvedValue([]);
  mockProjectFindMany.mockResolvedValue([]);
  mockTaskAggregate.mockResolvedValue({ _sum: { billing_amount: null }, _count: 0 });
  mockMilestoneAggregate.mockResolvedValue({ _sum: { billing_amount: null }, _count: 0 });
  mockSiteFindMany.mockResolvedValue([]);
  mockSnapshotFindFirst.mockResolvedValue(null);
  mockPhaseFindMany.mockResolvedValue([]);
  mockLinkFindMany.mockResolvedValue([]);
}

const OWNER_ACCESS = { contactId: 'contact-1', clientId: 'client-acme', role: 'owner' as const };

beforeEach(() => {
  vi.clearAllMocks();
  // A3: the signed-in contact is an owner of their own client unless a test overrides it.
  (prisma.clientContact.findFirst as Mock).mockResolvedValue({ client_id: 'client-acme', portal_role: 'owner', is_deleted: false });
});

describe('GET /api/portal/home', () => {
  it('returns 401 without a client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockClientFindFirst).not.toHaveBeenCalled();
  });

  it('returns 404 if the session client no longer resolves', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockClientFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('scopes every query to the session client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();

    await GET(makeRequest());

    const scopeOr = [{ client_id: 'client-acme' }, { site: { client_id: 'client-acme' } }];
    expect(mockClientFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'client-acme' });
    for (const call of mockArticleFindMany.mock.calls) {
      expect(call[0].where.client_id).toBe('client-acme');
    }
    // Pending-tasks query scopes directly via where.OR...
    expect(mockTaskFindMany.mock.calls[0][0].where.OR).toEqual(scopeOr);
    // ...the recent-activity task query combines the same scope OR with a second OR (status/
    // client_approved_at) via AND, so it doesn't get silently overwritten.
    expect(mockTaskFindMany.mock.calls[1][0].where.AND[0].OR).toEqual(scopeOr);
    expect(mockTaskAggregate.mock.calls[0][0].where.OR).toEqual(scopeOr);
    expect(mockProjectFindMany.mock.calls[0][0].where.client_id).toBe('client-acme');
    expect(mockSiteFindMany.mock.calls[0][0].where.client_id).toBe('client-acme');
    expect(mockMilestoneAggregate.mock.calls[0][0].where.project.client_id).toBe('client-acme');
  });

  it('returns an empty-state shape when the client has nothing pending', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.client).toEqual({ id: 'client-acme', name: 'Acme Co' });
    expect(body.pending_approvals).toEqual({ articles: [], tasks: [] });
    expect(body.projects).toEqual([]);
    expect(body.billing).toEqual({ open_amount: 0, open_count: 0 });
    expect(body.activity).toEqual([]);
    expect(body.stats).toEqual([]);
  });

  it('sums billing across tasks and milestones into a single open-amount summary', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockTaskAggregate.mockResolvedValue({ _sum: { billing_amount: 500 }, _count: 2 });
    mockMilestoneAggregate.mockResolvedValue({ _sum: { billing_amount: 1500 }, _count: 1 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.billing).toEqual({ open_amount: 2000, open_count: 3 });
  });

  it('the billing aggregate only counts client-visible work (A1 rule), not internal tasks', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();

    await GET(makeRequest());

    const where = mockTaskAggregate.mock.calls[0][0].where;
    expect(where.is_billable).toBe(true);
    expect(where.AND).toContainEqual(clientVisibleTaskWhere());
    expect(where.AND).toContainEqual(taskAccessWhere(OWNER_ACCESS));
  });

  it.each(['member', 'viewer'])('hides billing from a %s and never queries the aggregates', async (portal_role) => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    (prisma.clientContact.findFirst as Mock).mockResolvedValue({ client_id: 'client-acme', portal_role, is_deleted: false });
    setEmptyDefaults();

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.billing).toBeNull();
    expect(mockTaskAggregate).not.toHaveBeenCalled();
    expect(mockMilestoneAggregate).not.toHaveBeenCalled();
  });

  it('a project-only contact (role none) gets no billing, articles or stats', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    (prisma.clientContact.findFirst as Mock).mockResolvedValue({ client_id: 'client-acme', portal_role: 'none', is_deleted: false });
    setEmptyDefaults();

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.billing).toBeNull();
    expect(mockArticleFindMany.mock.calls[0][0].where.id).toEqual({ in: [] });
    expect(mockSiteFindMany.mock.calls[0][0].where.id).toEqual({ in: [] });
  });

  it('a deleted contact (no row) is treated as role none', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    (prisma.clientContact.findFirst as Mock).mockResolvedValue(null);
    setEmptyDefaults();

    const res = await GET(makeRequest());
    expect((await res.json()).billing).toBeNull();
  });

  it('open projects respect project visibility (hidden never, restricted for owners only)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();

    await GET(makeRequest());

    const where = mockProjectFindMany.mock.calls[0][0].where;
    expect(where.client_id).toBe('client-acme');
    expect(where.AND).toEqual([projectAccessScope(OWNER_ACCESS)]);
  });

  it('projects pending articles with their full comment thread, client-safe', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockArticleFindMany.mockResolvedValue([
      {
        id: 'art-1',
        title: 'Q3 Recap',
        status: 'in_review',
        body: 'body text',
        created_at: new Date('2026-06-20T10:00:00Z'),
        updated_at: new Date('2026-06-21T09:00:00Z'),
        comments: [{ id: 'c1', content: 'looks good', created_at: new Date(), user: { name: 'Bast' } }],
        // internal-only, must never leak
        research_summary: 'secret notes',
        client_id: 'client-acme',
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.pending_approvals.articles).toHaveLength(1);
    expect(body.pending_approvals.articles[0].comments).toEqual([
      { id: 'c1', content: 'looks good', author_name: 'Bast', created_at: expect.any(String) },
    ]);
    expect(body.pending_approvals.articles[0]).not.toHaveProperty('research_summary');
    expect(body.pending_approvals.articles[0]).not.toHaveProperty('client_id');
  });

  it('projects pending tasks with staging preview fields and no internal fields', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockTaskFindMany
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          title: 'Homepage refresh',
          description: null,
          status: 'review',
          estimated_minutes: 90,
          staging_preview_url: 'https://staging.example.com',
          staging_deployed_at: new Date('2026-06-21T10:00:00Z'),
          created_at: new Date(),
          updated_at: new Date(),
          billing_amount: 5000,
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.pending_approvals.tasks[0]).toMatchObject({
      id: 'task-1',
      staging_preview_url: 'https://staging.example.com',
    });
    expect(body.pending_approvals.tasks[0]).not.toHaveProperty('billing_amount');
  });

  it('applies the visibility rule to pending approvals and the activity feed (Leak 1)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();

    await GET(makeRequest());

    const calls = mockTaskFindMany.mock.calls.map((c) => c[0]);
    const pending = calls.find((a) => a.where.client_approved_at === null);
    expect(pending.where.AND).toEqual([clientVisibleTaskWhere(), stagedTaskWhere(), taskAccessWhere(OWNER_ACCESS)]);
    expect(pending.select).not.toHaveProperty('estimated_minutes');
    // The activity query ANDs the visibility fragment next to the client scope.
    const activity = calls.find((a) => a !== pending);
    expect(activity.where.AND).toContainEqual(clientHistoryTaskWhere());
  });

  it('home payload carries no estimated_minutes', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockTaskFindMany
      .mockResolvedValueOnce([
        { id: 't', title: 'x', description: null, status: 'review', estimated_minutes: 90,
          staging_preview_url: 'https://s.example', staging_deployed_at: null, created_at: new Date(), updated_at: new Date() },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET(makeRequest());
    expect(JSON.stringify(await res.json())).not.toContain('estimated_minutes');
  });

  it('merges recent tasks + published articles into one timestamp-sorted activity feed', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockTaskFindMany
      .mockResolvedValueOnce([]) // pending
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          title: 'Fix link',
          status: 'done',
          client_approved_at: null,
          completed_at: new Date('2026-06-15T00:00:00Z'),
          updated_at: new Date('2026-06-15T00:00:00Z'),
        },
      ]);
    mockArticleFindMany
      .mockResolvedValueOnce([]) // pending
      .mockResolvedValueOnce([
        {
          id: 'art-2',
          title: 'New Post',
          published_url: 'https://acme.com/blog/new-post',
          updated_at: new Date('2026-06-20T00:00:00Z'),
        },
      ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.activity).toHaveLength(2);
    // Newest first: the article (06-20) before the task (06-15).
    expect(body.activity[0]).toMatchObject({ type: 'article_published', id: 'art-2' });
    expect(body.activity[1]).toMatchObject({ type: 'task_completed', id: 'task-1' });
  });

  it('omits sites with no snapshot from stats, without fabricating data', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockSiteFindMany.mockResolvedValue([{ id: 'site-1', name: 'Acme Site' }]);
    mockSnapshotFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.stats).toEqual([]);
  });
});

describe('GET /api/portal/home (portal MVP A5 sections)', () => {
  const OPEN_PROJECT = {
    id: 'proj-1',
    name: 'Site relaunch',
    status: 'in_progress',
    target_date: new Date('2026-12-01T00:00:00Z'),
    updated_at: new Date('2026-10-15T00:00:00Z'),
  };

  it('gives each active project a client-words status, progress count, current phase and review link', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockProjectFindMany.mockResolvedValue([OPEN_PROJECT]);
    // Call order: pending approvals, recent activity, progress rows, open questions.
    mockTaskFindMany.mockImplementation(async (args: { where: { project_id?: unknown; tags?: unknown } }) => {
      if (args.where.project_id) {
        return [
          { id: 't1', title: 'Wireframes', project_id: 'proj-1', phase_id: 'ph1', status: 'done', requested_by_contact_id: 'c', client_visible: false, staging_preview_url: null, approved: false, client_approved_at: null, completed_at: new Date() },
          { id: 't2', title: 'Build', project_id: 'proj-1', phase_id: 'ph2', status: 'in_progress', requested_by_contact_id: 'c', client_visible: false, staging_preview_url: null, approved: false, client_approved_at: null, completed_at: null },
          { id: 't3', title: 'Dropped', project_id: 'proj-1', phase_id: 'ph2', status: 'abandoned', requested_by_contact_id: 'c', client_visible: false, staging_preview_url: null, approved: false, client_approved_at: null, completed_at: null },
        ];
      }
      return [];
    });
    mockPhaseFindMany.mockResolvedValue([
      { id: 'ph1', project_id: 'proj-1', name: 'Design', sort_order: 1 },
      { id: 'ph2', project_id: 'proj-1', name: 'Build', sort_order: 2 },
    ]);
    mockLinkFindMany.mockResolvedValue([
      { project_id: 'proj-1', name: 'Figma', url: 'https://figma.com/internal', icon: 'figma' },
      { project_id: 'proj-1', name: 'Review site copy', url: 'https://review.example/p', icon: 'review' },
    ]);

    const body = await (await GET(makeRequest())).json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      id: 'proj-1',
      status_label: 'In progress',
      progress: { done: 1, total: 2 },
      current_phase: 'Build',
      review_link: 'https://review.example/p',
    });
    expect(body.projects[0].status).toBeUndefined();
    expect(body.projects[0].links.map((l: { name: string }) => l.name)).toEqual(['Review site copy']);
    expect(body.needs_from_you.review_links).toEqual([
      { project_id: 'proj-1', project_name: 'Site relaunch', url: 'https://review.example/p' },
    ]);
    // Progress and links are scoped to the open projects only.
    expect(mockLinkFindMany.mock.calls[0][0].where.project_id).toEqual({ in: ['proj-1'] });
  });

  it('lists open questions with the newest client-visible comment, never an internal one', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockTaskFindMany.mockImplementation(async (args: { where: { tags?: unknown } }) =>
      args.where.tags
        ? [
            {
              id: 'q1',
              title: 'Pick a logo',
              comments: [
                { content: 'Internal: Bast tried twice', created_at: new Date('2026-10-12'), is_internal: true, client_question: true, user: { name: 'Bast', email: 'bast@x.example' } },
                { content: 'Which logo do you prefer?', created_at: new Date('2026-10-11'), is_internal: false, client_question: true, user: { name: 'Sabeen Khan', email: 's@x.example' } },
                { content: 'Unflagged chatter', created_at: new Date('2026-10-13'), is_internal: false, client_question: false, user: { name: 'Sabeen Khan', email: 's@x.example' } },
              ],
            },
          ]
        : []
    );
    const body = await (await GET(makeRequest())).json();
    expect(body.needs_from_you.questions).toEqual([
      { task_id: 'q1', title: 'Pick a logo', question: 'Which logo do you prefer?', asked_at: expect.anything() },
    ]);
    const questionCall = mockTaskFindMany.mock.calls.find((c) => c[0].where.tags)![0];
    expect(questionCall.where.tags).toEqual({ has: 'awaiting-clarification' });
    expect(questionCall.select.comments.where).toEqual({ is_deleted: false, is_internal: false, client_question: true });
    expect(questionCall.where.AND).toContainEqual(clientVisibleTaskWhere());
    expect(JSON.stringify(body)).not.toContain('Bast');
  });

  it('payload carries no estimates or internal fields', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    mockProjectFindMany.mockResolvedValue([OPEN_PROJECT]);
    mockTaskFindMany.mockResolvedValue([]);
    const body = await (await GET(makeRequest())).json();
    const text = JSON.stringify(body);
    for (const forbidden of ['estimated_minutes', 'energy_estimate', 'assignee', 'tags']) {
      expect(text).not.toContain(forbidden);
    }
    for (const call of mockTaskFindMany.mock.calls) {
      expect(Object.keys(call[0].select ?? {})).not.toContain('estimated_minutes');
    }
  });

  it('project-only contacts are scoped to granted projects for progress and questions too', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-2', role: 'none' });
    setEmptyDefaults();
    mockProjectFindMany.mockResolvedValue([OPEN_PROJECT]);
    mockTaskFindMany.mockResolvedValue([]);
    const body = await (await GET(makeRequest())).json();
    expect(body.billing).toBeNull();
    expect(body.pending_approvals.articles).toEqual([]);
    const taskAccess = taskAccessWhere({ contactId: 'contact-2', clientId: 'client-acme', role: 'none' });
    const scoped = mockTaskFindMany.mock.calls.filter((c) => JSON.stringify(c[0].where).includes('contact_grants'));
    // pending approvals, recent activity, progress rows, open questions and the two requests
    // queries (open, recently closed) all carry the grant scope.
    expect(scoped.length).toBe(6);
    for (const call of scoped) expect(JSON.stringify(call[0].where)).toContain(JSON.stringify(taskAccess));
  });

  it('recent activity leaves out staged-but-unapproved done work', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    await GET(makeRequest());
    const activityWhere = mockTaskFindMany.mock.calls[1][0].where;
    expect(activityWhere.AND).toContainEqual({
      OR: [{ status: 'done', NOT: stagedTaskWhere() }, { client_approved_at: { not: null } }],
    });
  });
});

describe('GET /api/portal/home requests summary (portal phase B slice 1)', () => {
  const requestRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `internal ${id}`,
    client_title: `Site change: ${id}`,
    status: 'not_started',
    tags: ['portal-chat', 'kind:site-change', 'needs-mike'],
    staging_preview_url: null,
    approved: false,
    client_approved_at: null,
    created_at: new Date('2026-10-20T10:00:00Z'),
    updated_at: new Date('2026-10-20T10:00:00Z'),
    project_id: null,
    charter_id: null,
    project: null,
    charter: null,
    site: { id: 'site-1', name: 'example.com' },
    ...over,
  });

  it('returns the open count and the top three, newest first, in client words only', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    const rows = [
      requestRow('a', { updated_at: new Date('2026-10-21T10:00:00Z') }),
      requestRow('b', { updated_at: new Date('2026-10-20T10:00:00Z'), tags: ['quote', 'needs-mike'] }),
      requestRow('c', { updated_at: new Date('2026-10-19T10:00:00Z') }),
      requestRow('d', { updated_at: new Date('2026-10-18T10:00:00Z') }),
    ];
    // The requests list is the only query with the client_title select.
    mockTaskFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && 'client_title' in args.select ? rows : []
    );
    const body = await (await GET(makeRequest())).json();
    expect(body.requests.open_count).toBe(4);
    expect(body.requests.top.map((r: { id: string }) => r.id)).toEqual(['a', 'b', 'c']);
    expect(body.requests.top[1]).toMatchObject({ title: 'Site change: b', state: { label: 'We will quote this', tone: 'quote' } });
    const text = JSON.stringify(body.requests);
    for (const leak of ['needs-mike', 'portal-chat', 'kind:', 'internal a']) expect(text).not.toContain(leak);
  });

  it('leaves out requests already under "Needs from you" (staged for review, waiting on an answer) but still counts them', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    const rows = [
      requestRow('staged', { status: 'review', staging_preview_url: 'https://staging.example.com' }),
      requestRow('asks', { tags: ['awaiting-clarification'] }),
      requestRow('plain'),
    ];
    mockTaskFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && 'client_title' in args.select ? rows : []
    );
    const body = await (await GET(makeRequest())).json();
    expect(body.requests.open_count).toBe(3);
    expect(body.requests.top.map((r: { id: string }) => r.id)).toEqual(['plain']);
  });

  it('reports no requests as an empty summary', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    setEmptyDefaults();
    const body = await (await GET(makeRequest())).json();
    expect(body.requests).toEqual({ open_count: 0, top: [] });
  });
});
