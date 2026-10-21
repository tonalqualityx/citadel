import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Stub only requireClientAuth (cookies/DB); assertClientScope, the projection, and error handling
// all run for real so the scope gate + client-safe shape are exercised end-to-end.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/portal/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/access')>();
  return {
    ...actual,
    loadPortalAccess: vi.fn(async () => ({ contactId: 'contact-1', clientId: 'client-acme', role: 'member' as const })),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findFirst: vi.fn() },
  },
}));

import { GET } from '../route';
import { loadPortalAccess } from '@/lib/portal/access';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockArticleFindFirst = prisma.article.findFirst as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/articles/art-1'));
}

function makeParams(id = 'art-1') {
  return { params: Promise.resolve({ id }) };
}

// A loosely-typed Prisma row carrying internal fields the projection must NOT pass through.
const articleRow = {
  id: 'art-1',
  title: 'Acme Q3 Recap',
  status: 'in_review',
  body: 'The body the client may read.',
  client_id: 'client-acme',
  created_at: '2026-06-20T10:00:00Z',
  updated_at: '2026-06-21T09:00:00Z',
  comments: [
    { id: 'c-1', content: 'A note from the team.', created_at: '2026-06-21T08:00:00Z', user: { name: 'Mike' } },
  ],
  // internal-only — present on a real selected row only via client_id; projection drops it.
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/articles/:id', () => {
  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(mockArticleFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked (deleted contact)', { role: 'none', revoked: true }],
    ['role none', { role: 'none' }],
  ])('404 for an existing in-review article when the contact is %s (access re-checked, article never loaded)', async (_label, access) => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    (loadPortalAccess as Mock).mockResolvedValueOnce({ contactId: 'contact-1', clientId: 'client-acme', ...access });
    mockArticleFindFirst.mockResolvedValue({ id: 'art-1', status: 'in_review', client_id: 'client-acme', client_approved_at: null, body: 'x' });
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
    expect(mockArticleFindFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the article does not exist', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 404 (not 403) for an internal draft stage — existence not leaked', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindFirst.mockResolvedValue({ ...articleRow, status: 'drafting' });

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 403 when the article belongs to another client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-other', contactId: 'contact-9' });
    mockArticleFindFirst.mockResolvedValue(articleRow);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it('projects the article client-safe — internal fields absent, comments shaped', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockArticleFindFirst.mockResolvedValue(articleRow);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const payload = await res.json();

    expect(payload.article).toMatchObject({
      id: 'art-1',
      title: 'Acme Q3 Recap',
      status: 'in_review',
      body: 'The body the client may read.',
    });
    // Comment shaped to client-safe form (author_name from user.name; no user object / ids).
    expect(payload.article.comments).toEqual([
      { id: 'c-1', content: 'A note from the team.', author_name: 'Mike', created_at: '2026-06-21T08:00:00Z' },
    ]);
    // Internal fields never leak.
    expect(payload.article).not.toHaveProperty('client_id');
    expect(payload.article).not.toHaveProperty('research_summary');

    // The query is scoped to the id and non-deleted.
    const where = mockArticleFindFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'art-1', is_deleted: false });
  });
});
