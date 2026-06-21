import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: { findUnique: vi.fn(), update: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/services/notifications', () => ({
  createNotification: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.comment.findUnique as Mock;
const mockUpdate = prisma.comment.update as Mock;
const mockUserFindMany = prisma.user.findMany as Mock;
const mockCreateNotification = createNotification as Mock;

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const MENTIONED = '22222222-2222-4222-8222-222222222222';
const COMMENT_ID = 'comment-1';

function patchRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/comments/${COMMENT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const ctx = { params: Promise.resolve({ id: COMMENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: AUTHOR, role: 'pm' } as never);
  mockFindUnique.mockResolvedValue({
    id: COMMENT_ID,
    user_id: AUTHOR,
    is_internal: false,
    mentioned_user_ids: [],
    task: { id: 'task-1', project_id: null, assignee_id: AUTHOR, title: 'Build the thing' },
  });
  // Default: no other active users, so no mentions resolve.
  mockUserFindMany.mockResolvedValue([]);
  mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: COMMENT_ID,
    task_id: 'task-1',
    user_id: AUTHOR,
    content: data.content ?? 'existing',
    is_internal: data.is_internal ?? false,
    created_at: new Date(),
    updated_at: new Date(),
    user: { id: AUTHOR, name: 'Bast', email: 'b@x.com', avatar_url: null },
  }));
});

describe('PATCH /api/comments/[id]', () => {
  it('toggles is_internal without touching content or mentions', async () => {
    const res = await PATCH(patchRequest({ is_internal: true }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_internal).toBe(true);
    // Content/mention recompute must not run when only toggling.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_internal: true } })
    );
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('still supports content-only edits and recomputes (empty) mentions', async () => {
    const res = await PATCH(patchRequest({ content: 'edited' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { content: 'edited', mentioned_user_ids: [] } })
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('notifies a user newly @-mentioned by an edit', async () => {
    mockUserFindMany.mockResolvedValue([{ id: MENTIONED, name: 'Sam Smith' }]);
    const res = await PATCH(patchRequest({ content: 'hey @Sam Smith look' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { content: 'hey @Sam Smith look', mentioned_user_ids: [MENTIONED] },
      })
    );
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MENTIONED,
        type: 'task_mentioned',
        entityType: 'task',
        entityId: 'task-1',
      })
    );
  });

  it('does not re-notify someone already mentioned before the edit', async () => {
    mockFindUnique.mockResolvedValue({
      id: COMMENT_ID,
      user_id: AUTHOR,
      is_internal: false,
      mentioned_user_ids: [MENTIONED],
      task: { id: 'task-1', project_id: null, assignee_id: AUTHOR, title: 'Build the thing' },
    });
    mockUserFindMany.mockResolvedValue([{ id: MENTIONED, name: 'Sam Smith' }]);
    const res = await PATCH(patchRequest({ content: 'still @Sam Smith here, edited' }), ctx);
    expect(res.status).toBe(200);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('never notifies the editor when they mention themselves', async () => {
    mockUserFindMany.mockResolvedValue([{ id: AUTHOR, name: 'Bast' }]);
    const res = await PATCH(patchRequest({ content: 'note to self @Bast' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { content: 'note to self @Bast', mentioned_user_ids: [] },
      })
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('rejects an empty update (no content, no is_internal)', async () => {
    const res = await PATCH(patchRequest({}), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
