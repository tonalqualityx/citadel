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
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.comment.findUnique as Mock;
const mockUpdate = prisma.comment.update as Mock;

const AUTHOR = '11111111-1111-4111-8111-111111111111';
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
    task: { id: 'task-1', project_id: null, assignee_id: AUTHOR },
  });
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
  it('toggles is_internal without touching content', async () => {
    const res = await PATCH(patchRequest({ is_internal: true }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_internal).toBe(true);
    // Content must not be in the update payload when only toggling.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_internal: true } })
    );
  });

  it('still supports content-only edits', async () => {
    const res = await PATCH(patchRequest({ content: 'edited' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { content: 'edited' } })
    );
  });

  it('rejects an empty update (no content, no is_internal)', async () => {
    const res = await PATCH(patchRequest({}), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
