import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api/errors';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { update: vi.fn() },
    comment: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { recordTaskClientApproval, recordTaskClientRequestChanges } from '../portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockTaskUpdate = prisma.task.update as Mock;
const mockCommentCreate = prisma.comment.create as Mock;
const mockUserFindFirst = prisma.user.findFirst as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindFirst.mockResolvedValue({ id: 'bast-user' });
});

describe('recordTaskClientApproval', () => {
  const baseTask = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true } };

  it('sets client_approved_at + approved_by_contact_id and returns the result', async () => {
    mockTaskUpdate.mockResolvedValue({});

    const result = await recordTaskClientApproval(baseTask, 'contact-1');

    expect(result.already_approved).toBe(false);
    expect(result.promotion_pending).toBe(false);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ approved_by_contact_id: 'contact-1' }),
    });
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call is a no-op and reports already_approved', async () => {
    const approvedAt = new Date('2026-06-20T09:00:00Z');
    const result = await recordTaskClientApproval(
      { ...baseTask, client_approved_at: approvedAt },
      'contact-1'
    );

    expect(result).toEqual({ already_approved: true, approved_at: approvedAt, promotion_pending: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('flags promotion_pending and writes an internal note for staged client sites (auto_deploy=false)', async () => {
    mockTaskUpdate.mockResolvedValue({});

    const result = await recordTaskClientApproval(
      { ...baseTask, site: { auto_deploy: false } },
      'contact-1'
    );

    expect(result.promotion_pending).toBe(true);
    expect(mockCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ task_id: 'task-1', is_internal: true, user_id: 'bast-user' }),
      })
    );
  });

  it('allows a null contactId (no resolvable contact)', async () => {
    mockTaskUpdate.mockResolvedValue({});

    await recordTaskClientApproval(baseTask, null);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ approved_by_contact_id: null }),
    });
  });
});

describe('recordTaskClientRequestChanges', () => {
  const baseTask = { id: 'task-1', client_approved_at: null };

  it('records a client-visible comment and re-opens the task', async () => {
    await recordTaskClientRequestChanges(baseTask, 'The logo is too small', 'Jane');

    expect(mockCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          task_id: 'task-1',
          is_internal: false,
          content: expect.stringContaining('The logo is too small'),
        }),
      })
    );
    expect(mockCommentCreate.mock.calls[0][0].data.content).toContain('Jane (client)');
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'not_started' },
    });
  });

  it('attributes to "Client" when no contact name is known', async () => {
    await recordTaskClientRequestChanges(baseTask, 'note', null);

    expect(mockCommentCreate.mock.calls[0][0].data.content).toContain('Client requested changes');
  });

  it('throws ApiError(400) when already approved, without writing anything', async () => {
    await expect(
      recordTaskClientRequestChanges(
        { ...baseTask, client_approved_at: new Date() },
        'note',
        'Jane'
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockCommentCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('throws ApiError(500) when no Bast user exists to attribute the comment to', async () => {
    mockUserFindFirst.mockResolvedValue(null);

    await expect(
      recordTaskClientRequestChanges(baseTask, 'note', 'Jane')
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it('throws a real ApiError instance (handleApiError can classify it)', async () => {
    try {
      await recordTaskClientRequestChanges(
        { ...baseTask, client_approved_at: new Date() },
        'note',
        'Jane'
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });
});
