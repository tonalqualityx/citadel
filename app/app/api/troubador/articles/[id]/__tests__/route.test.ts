import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    articleComment: {
      updateMany: vi.fn(),
    },
    troubadorRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    portalSession: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logStatusChange: vi.fn(),
}));

vi.mock('@/lib/services/troubador-notifications', () => ({
  notifyArticleNeedsReview: vi.fn().mockResolvedValue(undefined),
  notifyRunReviewReady: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindFirst = prisma.article.findFirst as Mock;
const mockFindMany = prisma.article.findMany as Mock;
const mockFindUnique = prisma.article.findUnique as Mock;
const mockUpdate = prisma.article.update as Mock;
const mockCommentUpdateMany = prisma.articleComment.updateMany as Mock;
const mockRunFindUnique = prisma.troubadorRun.findUnique as Mock;
const mockPortalSessionFindFirst = prisma.portalSession.findFirst as Mock;

const BOT = { userId: 'bot-1', role: 'pm', email: 'troubador@indelible.bot' };
const HUMAN = { userId: 'editor-1', role: 'pm', email: 'mike@becomeindelible.com' };

function patchReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/troubador/articles/a1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'a1' });

function articleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    run_id: 'run-1',
    site_id: 'site-1',
    title: 'Sourdough myths',
    status: 'in_review',
    locked: false,
    run: { id: 'run-1', assignee_id: 'editor-1' },
    ...overrides,
  };
}

describe('PATCH /api/troubador/articles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockFindMany.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(articleRow());
    mockRunFindUnique.mockResolvedValue({ stage: 'in_production' });
    mockPortalSessionFindFirst.mockResolvedValue(null);
  });

  it('forbids the Troubador worker from approving (403)', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow());

    const res = await PATCH(patchReq({ action: 'approve' }), { params });

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('lets a human approve, locking the copy and recording the approver', async () => {
    mockRequireAuth.mockResolvedValue(HUMAN);
    mockFindFirst.mockResolvedValue(articleRow());
    mockFindMany.mockResolvedValue([]); // for maybeAdvanceRunToDone

    const res = await PATCH(patchReq({ action: 'approve' }), { params });

    expect(res.status).toBe(200);
    expect(mockRequireRole).toHaveBeenCalledWith(HUMAN, ['pm', 'admin']);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('approved');
    expect(data.locked).toBe(true);
    expect(data.approved_by_id).toBe('editor-1');
    expect(data.approved_at).toBeInstanceOf(Date);
  });

  it('blocks the worker from touching an approved/locked article (409)', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'approved', locked: true }));

    const res = await PATCH(patchReq({ body: 'rewritten by worker' }), { params });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects scheduling onto a day already taken on the same site (409)', async () => {
    mockRequireAuth.mockResolvedValue(HUMAN);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'approved' }));
    // Another article on the same site already scheduled for the same UTC day.
    mockFindMany.mockResolvedValue([
      { scheduled_date: new Date('2026-07-10T09:00:00.000Z') },
    ]);

    const res = await PATCH(
      patchReq({ action: 'schedule', scheduled_date: '2026-07-10T15:00:00.000Z' }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('resolves outstanding feedback when a rewrite returns the article to review', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'needs_revision' }));

    const res = await PATCH(patchReq({ body: 'revised', status: 'in_review' }), { params });

    expect(res.status).toBe(200);
    expect(mockCommentUpdateMany).toHaveBeenCalledWith({
      where: { article_id: 'a1', is_feedback: true, resolved: false },
      data: { resolved: true },
    });
  });

  it('does NOT resolve feedback when the transition is not needs_revision -> in_review', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'drafting' }));

    await PATCH(patchReq({ status: 'in_review' }), { params });

    expect(mockCommentUpdateMany).not.toHaveBeenCalled();
  });

  it('lets the worker publish an approved/locked article (sets published + url) without 409', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'scheduled', locked: true }));

    const res = await PATCH(
      patchReq({ action: 'publish', published_url: 'https://site.com/post' }),
      { params }
    );

    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('published');
    expect(data.published_url).toBe('https://site.com/post');
  });

  it('still blocks the worker from EDITING locked copy (409)', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'approved', locked: true }));

    const res = await PATCH(patchReq({ body: 'worker tries to rewrite' }), { params });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('notifies the editor when the worker moves an article to in_review', async () => {
    const { notifyArticleNeedsReview } = await import(
      '@/lib/services/troubador-notifications'
    );
    mockRequireAuth.mockResolvedValue(BOT);
    mockFindFirst.mockResolvedValue(articleRow({ status: 'drafting' }));

    const res = await PATCH(patchReq({ status: 'in_review' }), { params });

    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('in_review');
    expect(notifyArticleNeedsReview).toHaveBeenCalledWith('a1');
  });

  describe('run-review-ready guard (notifyRunReviewReady)', () => {
    it('fires when a single-article run completes its review set', async () => {
      const { notifyRunReviewReady } = await import('@/lib/services/troubador-notifications');
      mockRequireAuth.mockResolvedValue(BOT);
      mockFindFirst.mockResolvedValue(articleRow({ status: 'drafting' }));
      mockFindMany.mockResolvedValue([]); // no siblings

      const res = await PATCH(patchReq({ status: 'in_review' }), { params });

      expect(res.status).toBe(200);
      expect(notifyRunReviewReady).toHaveBeenCalledWith('run-1');
    });

    it('does NOT fire while a sibling article is still drafting', async () => {
      const { notifyRunReviewReady } = await import('@/lib/services/troubador-notifications');
      mockRequireAuth.mockResolvedValue(BOT);
      mockFindFirst.mockResolvedValue(articleRow({ status: 'drafting' }));
      mockFindMany.mockResolvedValue([{ status: 'drafting' }]);

      const res = await PATCH(patchReq({ status: 'in_review' }), { params });

      expect(res.status).toBe(200);
      expect(notifyRunReviewReady).not.toHaveBeenCalled();
    });

    it('fires on a resubmission (needs_revision -> in_review) that completes the set', async () => {
      const { notifyRunReviewReady } = await import('@/lib/services/troubador-notifications');
      mockRequireAuth.mockResolvedValue(BOT);
      // This article was sent back for revision; no sibling is currently `in_review`, so the
      // set wasn't complete before this PATCH even though the sibling is already `approved`.
      mockFindFirst.mockResolvedValue(articleRow({ status: 'needs_revision' }));
      mockFindMany.mockResolvedValue([{ status: 'approved' }]);

      const res = await PATCH(patchReq({ body: 'revised', status: 'in_review' }), { params });

      expect(res.status).toBe(200);
      expect(notifyRunReviewReady).toHaveBeenCalledWith('run-1');
    });

    it('does NOT refire when the set was already complete before this PATCH', async () => {
      const { notifyRunReviewReady } = await import('@/lib/services/troubador-notifications');
      mockRequireAuth.mockResolvedValue(BOT);
      // A sibling is already `in_review` and everything else is review-or-beyond, so the set
      // was already complete before this transition — this one must not refire it.
      mockFindFirst.mockResolvedValue(articleRow({ status: 'needs_revision' }));
      mockFindMany.mockResolvedValue([{ status: 'in_review' }, { status: 'approved' }]);

      const res = await PATCH(patchReq({ body: 'revised', status: 'in_review' }), { params });

      expect(res.status).toBe(200);
      expect(notifyRunReviewReady).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/troubador/articles/[id] (client_last_viewed_at)', () => {
    it('returns null when the client has never viewed the article', async () => {
      mockRequireAuth.mockResolvedValue(HUMAN);
      mockFindFirst.mockResolvedValue(articleRow());
      mockPortalSessionFindFirst.mockResolvedValue(null);

      const res = await GET(new NextRequest('http://localhost:3000/api/troubador/articles/a1'), {
        params,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.client_last_viewed_at).toBeNull();
    });

    it('surfaces the most recent article_view PortalSession timestamp', async () => {
      mockRequireAuth.mockResolvedValue(HUMAN);
      mockFindFirst.mockResolvedValue(articleRow());
      const viewedAt = new Date('2026-07-11T10:00:00Z');
      mockPortalSessionFindFirst.mockResolvedValue({ created_at: viewedAt });

      const res = await GET(new NextRequest('http://localhost:3000/api/troubador/articles/a1'), {
        params,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.client_last_viewed_at).toBe(viewedAt.toISOString());
      expect(mockPortalSessionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token_type: 'article_view', entity_id: 'a1' },
        })
      );
    });
  });
});
