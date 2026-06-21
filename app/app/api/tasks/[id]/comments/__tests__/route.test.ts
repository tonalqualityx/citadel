import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    comment: { create: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
  },
}));

// Mock notifications
vi.mock('@/lib/services/notifications', () => ({
  createNotification: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockCommentCreate = prisma.comment.create as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockUserFindMany = prisma.user.findMany as Mock;
const mockCreateNotification = vi.mocked(createNotification);

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const ASSIGNEE = '22222222-2222-4222-8222-222222222222';
const MENTIONED = '33333333-3333-4333-8333-333333333333';
const GHOST = '44444444-4444-4444-8444-444444444444';
const TASK_ID = 'task-1';

function postRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/tasks/${TASK_ID}/comments`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const ctx = { params: Promise.resolve({ id: TASK_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: AUTHOR, role: 'pm' } as never);
  mockTaskFindUnique.mockResolvedValue({
    id: TASK_ID,
    title: 'A Task',
    project_id: null,
    assignee_id: ASSIGNEE,
    assignee: { id: ASSIGNEE },
  });
  mockUserFindUnique.mockResolvedValue({ name: 'Bast' });
  mockCommentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'comment-1',
    task_id: TASK_ID,
    user_id: AUTHOR,
    content: data.content,
    mentioned_user_ids: data.mentioned_user_ids,
    created_at: new Date(),
    updated_at: new Date(),
    user: { id: AUTHOR, name: 'Bast', email: 'b@x.com', avatar_url: null },
  }));
});

describe('POST /api/tasks/[id]/comments', () => {
  it('creates a comment and notifies the assignee with no mentions', async () => {
    mockUserFindMany.mockResolvedValue([]);

    const res = await POST(postRequest({ content: 'plain comment' }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe('plain comment');
    expect(body.mentioned_user_ids).toEqual([]);

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ASSIGNEE, type: 'comment_added' })
    );
  });

  it('emits a task_mentioned notification for each valid mentioned user', async () => {
    mockUserFindMany.mockResolvedValue([{ id: MENTIONED }]);

    const res = await POST(
      postRequest({ content: 'hey @Reshi', mentioned_user_ids: [MENTIONED] }),
      ctx
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mentioned_user_ids).toEqual([MENTIONED]);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: MENTIONED, type: 'task_mentioned' })
    );
    // assignee (not mentioned) still gets comment_added
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ASSIGNEE, type: 'comment_added' })
    );
  });

  it('never notifies the author for a self-mention', async () => {
    // author requests to mention themselves; they are filtered before the DB lookup
    mockUserFindMany.mockResolvedValue([]);

    await POST(
      postRequest({ content: 'note to self @me', mentioned_user_ids: [AUTHOR] }),
      ctx
    );

    expect(mockUserFindMany).not.toHaveBeenCalled();
    const notifiedAuthor = mockCreateNotification.mock.calls.some(
      ([arg]) => (arg as { userId: string }).userId === AUTHOR
    );
    expect(notifiedAuthor).toBe(false);
  });

  it('does not double-notify the assignee when they are also mentioned', async () => {
    mockUserFindMany.mockResolvedValue([{ id: ASSIGNEE }]);

    await POST(
      postRequest({ content: '@Assignee look', mentioned_user_ids: [ASSIGNEE] }),
      ctx
    );

    const assigneeCalls = mockCreateNotification.mock.calls.filter(
      ([arg]) => (arg as { userId: string }).userId === ASSIGNEE
    );
    expect(assigneeCalls).toHaveLength(1);
    expect((assigneeCalls[0][0] as { type: string }).type).toBe('task_mentioned');
  });

  it('drops mentioned ids that are not real active users', async () => {
    // request mentions one id, but the DB returns no active match
    mockUserFindMany.mockResolvedValue([]);

    const res = await POST(
      postRequest({ content: '@ghost', mentioned_user_ids: [GHOST] }),
      ctx
    );
    const body = await res.json();
    expect(body.mentioned_user_ids).toEqual([]);

    const mentionNotifs = mockCreateNotification.mock.calls.filter(
      ([arg]) => (arg as { type: string }).type === 'task_mentioned'
    );
    expect(mentionNotifs).toHaveLength(0);
  });
});
