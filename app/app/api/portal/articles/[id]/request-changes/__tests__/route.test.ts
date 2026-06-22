import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Stub only requireClientAuth; assertClientScope runs for real (cross-client gate exercised).
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findFirst: vi.fn(), update: vi.fn() },
    articleComment: { create: vi.fn() },
    clientContact: { findUnique: vi.fn() },
    // The route wraps the comment+status writes in a transaction; the array elements are built by
    // calling create()/update() (so we can assert on them), then handed to $transaction.
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

import { POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAuth = requireClientAuth as Mock;
const mockFindFirst = prisma.article.findFirst as Mock;
const mockUpdate = prisma.article.update as Mock;
const mockCommentCreate = prisma.articleComment.create as Mock;
const mockContact = prisma.clientContact.findUnique as Mock;

function makeRequest(body: unknown = { note: 'Fix the intro' }): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/articles/art-1/request-changes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const makeParams = (id = 'art-1') => ({ params: Promise.resolve({ id }) });

const articleRow = {
  id: 'art-1',
  status: 'in_review',
  client_id: 'client-acme',
  client_approved_at: null,
  body: 'The body.',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/portal/articles/:id/request-changes', () => {
  it('401 when there is no client session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('404 when the article does not exist', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('404 (not 403) for an internal draft — existence not leaked', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({ ...articleRow, status: 'drafting' });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it('403 when the article belongs to another client', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-other', contactId: 'contact-9' });
    mockFindFirst.mockResolvedValue(articleRow);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it('409 when the article has already been approved', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({
      ...articleRow,
      status: 'approved',
      client_approved_at: new Date('2026-06-20T00:00:00Z'),
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(409);
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it('400 when the note is empty', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    const res = await POST(makeRequest({ note: '' }), makeParams());
    expect(res.status).toBe(400);
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it('records a client-visible (Bast-masked) comment and sets status needs_revision', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    mockContact.mockResolvedValue({ name: 'Jane' });

    const res = await POST(makeRequest({ note: 'Tighten the opening paragraph.' }), makeParams());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.status).toBe('needs_revision');

    // Author is null (renders as "Indelible" client-side — the worker persona never leaks); the
    // client's identity lives in the content, not the author field.
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        article_id: 'art-1',
        user_id: null,
        is_feedback: true,
        content: expect.stringContaining('Jane (client) requested changes via the portal'),
      }),
    });
    expect(mockCommentCreate.mock.calls[0][0].data.content).toContain('Tighten the opening paragraph.');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'art-1' },
      data: { status: 'needs_revision', locked: false },
    });
  });

  it('falls back to a neutral attribution when the contact has no name', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    mockContact.mockResolvedValue(null);

    const res = await POST(makeRequest({ note: 'Please revise.' }), makeParams());
    expect(res.status).toBe(200);
    expect(mockCommentCreate.mock.calls[0][0].data.content).toContain('Client requested changes');
  });
});
