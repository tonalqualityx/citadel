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
vi.mock('@/lib/portal/waits', () => ({ onClientMessage: vi.fn(async () => ({ stopped: 0, flagged: 0, opened: null })) }));

import { recordTaskClientApproval, recordTaskClientRequestChanges, SEND_BACK_TAG } from '../portal';
import { prisma } from '@/lib/db/prisma';
import { onClientMessage } from '@/lib/portal/waits';
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
  const baseTask = { id: 'task-1', client_approved_at: null, title: 'Homepage', client_title: 'Homepage refresh', assignee_id: 'staff-1', client_id: 'cl1', project_id: null, charter_id: null, site_id: 's1', tags: ['portal-chat'] };

  beforeEach(() => {
    mockCommentCreate.mockResolvedValue({ id: 'cm1' });
  });

  it('stores the client words verbatim under the contact: no prefix, no staff or bot author, client-visible, not internal', async () => {
    await recordTaskClientRequestChanges(baseTask, 'The logo is too small', 'Jane', 'contact-1');
    expect(mockCommentCreate.mock.calls[0][0].data).toEqual({
      task_id: 'task-1',
      user_id: null,
      content: 'The logo is too small',
      is_internal: false,
      client_visible: true,
      author_contact_id: 'contact-1',
    });
  });

  it('re-opens the task and marks the send-back with the machine-readable tag, keeping its other tags', async () => {
    await recordTaskClientRequestChanges(baseTask, 'note', 'Jane', 'contact-1');
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'not_started', tags: ['portal-chat', SEND_BACK_TAG] },
    });
    expect(SEND_BACK_TAG).toBe('client-sent-back');
  });

  it('does not duplicate the tag on a second send-back', async () => {
    await recordTaskClientRequestChanges({ ...baseTask, tags: [SEND_BACK_TAG] }, 'again', 'Jane', 'contact-1');
    expect(mockTaskUpdate.mock.calls[0][0].data.tags).toEqual([SEND_BACK_TAG]);
  });

  it('runs the client-message wait effects with the contact and the new comment', async () => {
    await recordTaskClientRequestChanges(baseTask, 'note', 'Jane', 'contact-1');
    expect(onClientMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task-1', client_title: 'Homepage refresh', assignee_id: 'staff-1' }),
      { contact_ids: ['contact-1'], comment_id: 'cm1' }
    );
  });

  it('refuses without a contact: the words are never written under anyone else', async () => {
    await expect(recordTaskClientRequestChanges(baseTask, 'note', null, null)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCommentCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('throws ApiError(400) when already approved, without writing anything', async () => {
    await expect(
      recordTaskClientRequestChanges({ ...baseTask, client_approved_at: new Date() }, 'note', 'Jane', 'contact-1')
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCommentCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('throws a real ApiError instance (handleApiError can classify it)', async () => {
    try {
      await recordTaskClientRequestChanges({ ...baseTask, client_approved_at: new Date() }, 'note', 'Jane', 'contact-1');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });

  it('a failure in the wait effects never loses the note', async () => {
    (onClientMessage as Mock).mockRejectedValueOnce(new Error('wait store down'));
    await expect(recordTaskClientRequestChanges(baseTask, 'note', 'Jane', 'contact-1')).resolves.toBeUndefined();
    expect(mockTaskUpdate).toHaveBeenCalled();
  });
});
