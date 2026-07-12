import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Stub only requireClientAuth (cookies/DB); assertClientScope runs for real so the cross-client
// scope gate is exercised end-to-end. recordArticleClientApproval is stubbed so this test isolates
// the route's own guards/status-advance from the (separately-tested) approval helper.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/services/portal', () => ({
  recordArticleClientApproval: vi.fn(),
}));

// notifyArticleClientApproved is fire-and-forget; stub it so this test asserts the route's own
// call (right entity, right guard) without exercising the (separately-tested) notification body.
vi.mock('@/lib/services/troubador-notifications', () => ({
  notifyArticleClientApproved: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { recordArticleClientApproval } from '@/lib/services/portal';
import { notifyArticleClientApproved } from '@/lib/services/troubador-notifications';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAuth = requireClientAuth as Mock;
const mockFindFirst = prisma.article.findFirst as Mock;
const mockUpdate = prisma.article.update as Mock;
const mockRecord = recordArticleClientApproval as Mock;
const mockNotify = notifyArticleClientApproved as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/articles/art-1/approve'), {
    method: 'POST',
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

describe('POST /api/portal/articles/:id/approve', () => {
  it('401 when there is no client session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('404 when the article does not exist', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
    expect(mockRecord).not.toHaveBeenCalled();
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
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('409 when the article is not in a reviewable stage', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({ ...articleRow, status: 'published' });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(409);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records approval (attributed to the acting contact) and advances status to approved', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue(articleRow);
    mockRecord.mockResolvedValue({
      approved_at: new Date('2026-06-22T00:00:00Z'),
      contact_id: 'contact-1',
      already_approved: false,
    });
    mockUpdate.mockResolvedValue({});

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toMatchObject({ status: 'approved', already_approved: false });

    expect(mockRecord).toHaveBeenCalledWith('art-1', 'contact-1');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'art-1' },
      data: { status: 'approved' },
    });
    expect(mockNotify).toHaveBeenCalledWith('art-1');
  });

  it('is idempotent — an already-approved article re-confirms without churning status', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockFindFirst.mockResolvedValue({
      ...articleRow,
      status: 'approved',
      client_approved_at: new Date('2026-06-20T00:00:00Z'),
    });
    mockRecord.mockResolvedValue({
      approved_at: new Date('2026-06-20T00:00:00Z'),
      contact_id: 'contact-prev',
      already_approved: true,
    });

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.already_approved).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    // No notification on the idempotent re-confirm — only a genuine first approval notifies.
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
