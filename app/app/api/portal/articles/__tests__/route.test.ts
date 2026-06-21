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
});
