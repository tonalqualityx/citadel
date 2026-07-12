import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Stub only requireClientAuth; assertClientScope + the client projection run for real.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { PATCH } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAuth = requireClientAuth as Mock;
const mockFindFirst = prisma.article.findFirst as Mock;
const mockUpdate = prisma.article.update as Mock;

function makeRequest(body: unknown = { body: 'Edited body.' }): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/articles/art-1'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const makeParams = (id = 'art-1') => ({ params: Promise.resolve({ id }) });

// No `site` key by default — loadActionableArticle flattens `article.site?.site_type ?? null`,
// so an absent relation (as a real WordPress-unaware row, or a lean test double) falls back to the
// heuristic (body starts with '<') for HTML detection.
const articleRow = {
  id: 'art-1',
  status: 'in_review',
  client_id: 'client-acme',
  client_approved_at: null,
  body: 'Original body.',
};

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/portal/articles/:id (save edits)', () => {
  it('401 when there is no client session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('404 when the article does not exist', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(null);
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('404 (not 403) for an internal draft — existence not leaked', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({ ...articleRow, status: 'drafting' });
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('403 when the article belongs to another client', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-other', contactId: 'contact-9' });
    mockFindFirst.mockResolvedValue(articleRow);
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('409 when the article has already been approved (body frozen)', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({
      ...articleRow,
      status: 'approved',
      client_approved_at: new Date('2026-06-20T00:00:00Z'),
    });
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('409 when the article is not in a reviewable stage', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({ ...articleRow, status: 'published' });
    const res = await PATCH(makeRequest(), makeParams());
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('persists the body and returns the client-safe projection', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    mockUpdate.mockResolvedValue({
      id: 'art-1',
      title: 'Acme Q3 Recap',
      status: 'in_review',
      body: 'Edited body.',
      created_at: '2026-06-20T10:00:00Z',
      updated_at: '2026-06-22T00:00:00Z',
      comments: [],
    });

    const res = await PATCH(makeRequest({ body: 'Edited body.' }), makeParams());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.article).toMatchObject({ id: 'art-1', body: 'Edited body.' });
    // Internal fields never leak through the projection.
    expect(payload.article).not.toHaveProperty('client_id');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'art-1' }, data: { body: 'Edited body.' } })
    );
  });

  it('400 when the body field is missing', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    const res = await PATCH(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  describe('HTML validation (WordPress bodies)', () => {
    it('400 with a friendly message when site_type is wordpress and the body is broken HTML', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      mockFindFirst.mockResolvedValue({ ...articleRow, site: { site_type: 'wordpress' } });

      const res = await PATCH(makeRequest({ body: '<div><p>Unclosed' }), makeParams());
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.error).toContain('<div>');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('200 when site_type is wordpress and the body is well-formed HTML', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      mockFindFirst.mockResolvedValue({ ...articleRow, site: { site_type: 'wordpress' } });
      mockUpdate.mockResolvedValue({
        id: 'art-1',
        title: 'Acme Q3 Recap',
        status: 'in_review',
        body: '<p>Fine.</p>',
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
        comments: [],
      });

      const res = await PATCH(makeRequest({ body: '<p>Fine.</p>' }), makeParams());
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('400 via the heuristic (no site relation) when the body looks like broken HTML', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      // No `site` key at all — site_type flattens to null, so the heuristic kicks in.
      mockFindFirst.mockResolvedValue({ ...articleRow });

      const res = await PATCH(makeRequest({ body: '<div><p>Unclosed' }), makeParams());
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('plain prose with no tags still passes on a wordpress site (nothing structural to flag)', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      mockFindFirst.mockResolvedValue({ ...articleRow, site: { site_type: 'wordpress' } });
      mockUpdate.mockResolvedValue({
        id: 'art-1',
        title: 'Acme Q3 Recap',
        status: 'in_review',
        body: 'Just plain prose, no markup at all.',
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
        comments: [],
      });

      const res = await PATCH(
        makeRequest({ body: 'Just plain prose, no markup at all.' }),
        makeParams()
      );
      expect(res.status).toBe(200);
    });

    it('does not run HTML validation via the heuristic when site_type is unknown and body is not HTML-looking', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      // No `site` key → site_type null → heuristic path. Body doesn't start with '<', so the
      // heuristic never treats it as HTML even though it contains an unbalanced angle bracket.
      mockFindFirst.mockResolvedValue({ ...articleRow });
      mockUpdate.mockResolvedValue({
        id: 'art-1',
        title: 'Acme Q3 Recap',
        status: 'in_review',
        body: 'Revenue grew 3 < 5 years running, unlike <div this fragment.',
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
        comments: [],
      });

      const res = await PATCH(
        makeRequest({ body: 'Revenue grew 3 < 5 years running, unlike <div this fragment.' }),
        makeParams()
      );
      expect(res.status).toBe(200);
    });

    it('allows clearing the body to empty even when site_type is wordpress', async () => {
      mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
      mockFindFirst.mockResolvedValue({ ...articleRow, site: { site_type: 'wordpress' } });
      mockUpdate.mockResolvedValue({
        id: 'art-1',
        title: 'Acme Q3 Recap',
        status: 'in_review',
        body: '',
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
        comments: [],
      });

      const res = await PATCH(makeRequest({ body: '' }), makeParams());
      expect(res.status).toBe(200);
    });
  });
});
