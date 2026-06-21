import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findFirst: vi.fn(), update: vi.fn() },
    articleComment: { create: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/services/notifications', () => ({
  createNotification: vi.fn(),
}));

vi.mock('@/lib/api/troubador-formatters', () => ({
  formatArticleCommentResponse: (c: unknown) => c,
}));

vi.mock('@/lib/troubador/run-stage', () => ({
  recomputeProductionStage: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';
import { recomputeProductionStage } from '@/lib/troubador/run-stage';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockArticleFind = prisma.article.findFirst as Mock;
const mockArticleUpdate = prisma.article.update as Mock;
const mockCommentCreate = prisma.articleComment.create as Mock;
const mockUserFindMany = prisma.user.findMany as Mock;
const mockCreateNotification = createNotification as Mock;
const mockRecompute = recomputeProductionStage as Mock;

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const MENTIONED = '22222222-2222-4222-8222-222222222222';
const ARTICLE_ID = 'article-1';

function postRequest(body: object): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/troubador/articles/${ARTICLE_ID}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

const ctx = { params: Promise.resolve({ id: ARTICLE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: AUTHOR, role: 'pm' } as never);
  mockArticleFind.mockResolvedValue({
    id: ARTICLE_ID,
    title: 'How to Build a Citadel',
    status: 'draft',
    run_id: 'run-1',
  });
  mockUserFindMany.mockResolvedValue([]);
  mockCommentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'comment-1',
    article_id: ARTICLE_ID,
    user_id: data.user_id,
    content: data.content,
    is_feedback: true,
    created_at: new Date(),
    user: { id: AUTHOR, name: 'Bast', email: 'b@x.com' },
  }));
});

describe('POST /api/troubador/articles/[id]/comments', () => {
  it('notifies a user @-mentioned in an article comment', async () => {
    mockUserFindMany.mockResolvedValue([{ id: MENTIONED, name: 'Sam Smith' }]);
    const res = await POST(postRequest({ content: 'good draft @Sam Smith' }), ctx);
    expect(res.status).toBe(200);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MENTIONED,
        type: 'task_mentioned',
        entityType: 'article',
        entityId: ARTICLE_ID,
      })
    );
  });

  it('never notifies the author who mentions themselves', async () => {
    mockUserFindMany.mockResolvedValue([{ id: AUTHOR, name: 'Bast' }]);
    const res = await POST(postRequest({ content: 'note to self @Bast' }), ctx);
    expect(res.status).toBe(200);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('creates no notification when there is no mention', async () => {
    const res = await POST(postRequest({ content: 'just plain feedback' }), ctx);
    expect(res.status).toBe(200);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('still reopens an article past drafting and notifies the mention', async () => {
    mockArticleFind.mockResolvedValue({
      id: ARTICLE_ID,
      title: 'How to Build a Citadel',
      status: 'in_review',
      run_id: 'run-1',
    });
    mockUserFindMany.mockResolvedValue([{ id: MENTIONED, name: 'Sam Smith' }]);
    const res = await POST(postRequest({ content: 'please revise @Sam Smith' }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.article_status).toBe('needs_revision');
    expect(mockArticleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ARTICLE_ID },
        data: { status: 'needs_revision', locked: false },
      })
    );
    expect(mockRecompute).toHaveBeenCalledWith('run-1');
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });
});
