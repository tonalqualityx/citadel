import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    clientContact: {
      findFirst: vi.fn(),
    },
  },
}));

import { recordArticleClientApproval, resolveArticleContact } from '../portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockArticleFindFirst = prisma.article.findFirst as Mock;
const mockArticleUpdate = prisma.article.update as Mock;
const mockContactFindFirst = prisma.clientContact.findFirst as Mock;

describe('resolveArticleContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the client primary contact', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: 'contact-1',
      name: 'Jane',
      email: 'jane@acme.com',
      client_id: 'client-1',
    });

    const contact = await resolveArticleContact({ client_id: 'client-1' });

    expect(contact?.id).toBe('contact-1');
    expect(mockContactFindFirst).toHaveBeenCalledWith({
      where: { client_id: 'client-1', is_primary: true, is_deleted: false },
      select: { id: true, name: true, email: true, client_id: true },
    });
  });

  it('returns null when the client has no primary contact', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    expect(await resolveArticleContact({ client_id: 'client-1' })).toBeNull();
  });
});

describe('recordArticleClientApproval', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records approval, resolving the client primary contact when none supplied', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article-1',
      client_id: 'client-1',
      client_approved_at: null,
      approved_by_contact_id: null,
    });
    mockContactFindFirst.mockResolvedValue({
      id: 'contact-1',
      name: 'Jane',
      email: 'jane@acme.com',
      client_id: 'client-1',
    });
    mockArticleUpdate.mockResolvedValue({});

    const result = await recordArticleClientApproval('article-1');

    expect(result).not.toBeNull();
    expect(result!.already_approved).toBe(false);
    expect(result!.contact_id).toBe('contact-1');
    expect(result!.approved_at).toBeInstanceOf(Date);
    expect(mockArticleUpdate).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: expect.objectContaining({
        approved_by_contact_id: 'contact-1',
        client_approved_at: expect.any(Date),
      }),
    });
  });

  it('uses an explicitly-supplied contactId without resolving the primary contact', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article-1',
      client_id: 'client-1',
      client_approved_at: null,
      approved_by_contact_id: null,
    });
    mockArticleUpdate.mockResolvedValue({});

    const result = await recordArticleClientApproval('article-1', 'contact-explicit');

    expect(result!.contact_id).toBe('contact-explicit');
    expect(mockContactFindFirst).not.toHaveBeenCalled();
    expect(mockArticleUpdate).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: expect.objectContaining({ approved_by_contact_id: 'contact-explicit' }),
    });
  });

  it('records approval with a null contact when none can be resolved', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article-1',
      client_id: 'client-1',
      client_approved_at: null,
      approved_by_contact_id: null,
    });
    mockContactFindFirst.mockResolvedValue(null);
    mockArticleUpdate.mockResolvedValue({});

    const result = await recordArticleClientApproval('article-1');

    expect(result!.contact_id).toBeNull();
    expect(result!.already_approved).toBe(false);
  });

  it('is idempotent — an already-approved article is a no-op', async () => {
    const approvedAt = new Date('2026-06-20T12:00:00Z');
    mockArticleFindFirst.mockResolvedValue({
      id: 'article-1',
      client_id: 'client-1',
      client_approved_at: approvedAt,
      approved_by_contact_id: 'contact-prev',
    });

    const result = await recordArticleClientApproval('article-1');

    expect(result).toEqual({
      approved_at: approvedAt,
      contact_id: 'contact-prev',
      already_approved: true,
    });
    expect(mockArticleUpdate).not.toHaveBeenCalled();
  });

  it('returns null for a missing or deleted article', async () => {
    mockArticleFindFirst.mockResolvedValue(null);
    expect(await recordArticleClientApproval('nope')).toBeNull();
    expect(mockArticleUpdate).not.toHaveBeenCalled();
  });
});
