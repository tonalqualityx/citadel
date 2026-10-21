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
