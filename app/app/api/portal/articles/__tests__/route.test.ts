import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Stub only requireClientAuth (reads cookies/DB); everything else (the projection, error handling)
// runs for real so the client-safe shape is exercised end-to-end.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/articles'));
}

// A loosely-typed Prisma row carrying internal fields the projection must NOT pass through.
const internalArticleRow = {
  id: 'art-1',
  title: 'Acme Q3 Recap',
  status: 'in_review',
  body: 'The body the client may read.',
  created_at: '2026-06-20T10:00:00Z',
  updated_at: '2026-06-21T09:00:00Z',
  // internal-only — present on a real row, must be dropped by the allow-list projection
  research_summary: 'internal research notes',
  check_report: { score: 0.9 },
  client_id: 'client-acme',
  run_id: 'run-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/articles', () => {
  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockArticleFindMany).not.toHaveBeenCalled();
  });

  it('lists only the session client\'s in_review articles, scoped by the where clause', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindMany.mockResolvedValue([internalArticleRow]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    // The query is scoped to the session's client, in_review only, non-deleted.
    const where = mockArticleFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ client_id: 'client-acme', status: 'in_review', is_deleted: false });
  });

  it('projects each row client-safe — no internal field leaks', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindMany.mockResolvedValue([internalArticleRow]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.articles).toHaveLength(1);
    const article = body.articles[0];
    // Allow-listed fields are present...
    expect(article).toMatchObject({
      id: 'art-1',
      title: 'Acme Q3 Recap',
      status: 'in_review',
      body: 'The body the client may read.',
      comments: [],
    });
    // ...and internal fields are absent.
    expect(article).not.toHaveProperty('research_summary');
    expect(article).not.toHaveProperty('check_report');
    expect(article).not.toHaveProperty('client_id');
    expect(article).not.toHaveProperty('run_id');
  });

  it('returns an empty list when the client has no in_review articles', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.articles).toEqual([]);
  });

  // The three read-only status groups (in_revision / approved / published) are separate,
  // independently-scoped findMany calls so the in-review query above is untouched. Route each
  // call by its `where.status` to exercise all four groups from one mock.
  function mockFourGroups() {
    mockArticleFindMany.mockImplementation((args: any) => {
      const status = args.where.status;
      if (status === 'in_review') return Promise.resolve([]);
      if (status === 'needs_revision') {
        return Promise.resolve([
          {
            id: 'art-2',
            title: 'Revising Now',
            status: 'needs_revision',
            updated_at: '2026-06-22T00:00:00Z',
            published_url: null,
          },
        ]);
      }
      if (status && typeof status === 'object' && 'in' in status) {
        return Promise.resolve([
          {
            id: 'art-3',
            title: 'Approved Piece',
            status: 'approved',
            updated_at: '2026-06-23T00:00:00Z',
            published_url: null,
          },
        ]);
      }
      if (status === 'published') {
        return Promise.resolve([
          {
            id: 'art-4',
            title: 'Published Piece',
            status: 'published',
            updated_at: '2026-06-24T00:00:00Z',
            published_url: 'https://client.example.com/blog/published-piece',
          },
        ]);
      }
      return Promise.resolve([]);
    });
  }

  it('returns in_revision for needs_revision articles, client-safe projected', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFourGroups();

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.in_revision).toEqual([
      { id: 'art-2', title: 'Revising Now', status: 'needs_revision', updated_at: '2026-06-22T00:00:00Z' },
    ]);
  });

  it('returns approved for both approved and scheduled statuses (status: { in })', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFourGroups();

    const res = await GET(makeRequest());

    // The approved-group query asks for both statuses in one clause.
    const approvedCall = mockArticleFindMany.mock.calls.find(
      (call: any) => call[0].where.status && typeof call[0].where.status === 'object'
    );
    expect(approvedCall).toBeDefined();
    expect(approvedCall![0].where.status).toEqual({ in: ['approved', 'scheduled'] });

    const body = await res.json();
    expect(body.approved).toEqual([
      { id: 'art-3', title: 'Approved Piece', status: 'approved', updated_at: '2026-06-23T00:00:00Z' },
    ]);
  });

  it('returns published articles including published_url', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFourGroups();

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.published).toEqual([
      {
        id: 'art-4',
        title: 'Published Piece',
        status: 'published',
        updated_at: '2026-06-24T00:00:00Z',
        published_url: 'https://client.example.com/blog/published-piece',
      },
    ]);
  });

  it('never includes published_url on non-published summaries', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFourGroups();

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.in_revision[0]).not.toHaveProperty('published_url');
    expect(body.approved[0]).not.toHaveProperty('published_url');
  });

  it('all four groups are scoped to the session client and non-deleted', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFourGroups();

    await GET(makeRequest());

    expect(mockArticleFindMany).toHaveBeenCalledTimes(4);
    for (const call of mockArticleFindMany.mock.calls) {
      expect((call[0] as any).where.client_id).toBe('client-acme');
      expect((call[0] as any).where.is_deleted).toBe(false);
    }
  });
});
