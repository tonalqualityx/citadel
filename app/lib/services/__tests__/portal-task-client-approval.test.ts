import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api/errors';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    comment: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]))),
    // Tag updates are raw single-statement UPDATEs; the mock keeps the SQL text and values to assert on.
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })),
  },
}));
vi.mock('@/lib/sends/claims', () => ({ clearPreviewClaims: vi.fn(async () => undefined) }));
vi.mock('@/lib/portal/receipts', () => ({ stampApproval: vi.fn(async () => null), getApprovalBindingMode: vi.fn(async () => 'enforce') })); // Fleet item 5: the receipt is tested in receipts.integration.test.ts
vi.mock('@/lib/portal/staff-alert', () => ({ alertTaskOwner: vi.fn(async () => undefined) }));
vi.mock('@/lib/portal/waits', () => ({ onClientMessage: vi.fn(async () => ({ stopped: 0, flagged: 0, opened: null })) }));

import { recordTaskClientApproval, recordTaskClientRequestChanges, recordUnattributedSendBack, SEND_BACK_TAG } from '../portal';
import { alertTaskOwner } from '@/lib/portal/staff-alert';
import { prisma } from '@/lib/db/prisma';
import { onClientMessage } from '@/lib/portal/waits';
import { stampApproval, getApprovalBindingMode } from '@/lib/portal/receipts';
import type { Mock } from 'vitest';

const mockTaskUpdate = prisma.task.update as Mock;
const mockUpdateMany = prisma.task.updateMany as Mock;
const mockFindUnique = prisma.task.findUnique as Mock;
const mockCommentCreate = prisma.comment.create as Mock;
const mockUserFindFirst = prisma.user.findFirst as Mock;
const mockExecuteRaw = prisma.$executeRaw as unknown as Mock;
const rawCalls = () => mockExecuteRaw.mock.calls.map(([strings, ...values]) => ({ sql: (strings as string[]).join('?'), values }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindFirst.mockResolvedValue({ id: 'bast-user' });
  mockUpdateMany.mockResolvedValue({ count: 1 });
  (getApprovalBindingMode as Mock).mockResolvedValue('enforce');
});

describe('recordTaskClientApproval', () => {
  const baseTask = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true } };

  it('sets client_approved_at + approved_by_contact_id and returns the result', async () => {
    mockTaskUpdate.mockResolvedValue({});

    const result = await recordTaskClientApproval(baseTask, 'contact-1');

    expect(result.already_approved).toBe(false);
    expect(result.promotion_pending).toBe(false);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', client_approved_at: null, staging_preview_url: null },
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
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

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'task-1' }),
      data: expect.objectContaining({ approved_by_contact_id: null }),
    });
  });
});

describe('recordTaskClientApproval: bound to what the client saw', () => {
  const baseTask = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true } };
  const deployed = '2026-10-22T12:00:00.000Z';

  it('guards the update on the preview address and the deploy time the page loaded', async () => {
    await recordTaskClientApproval(baseTask, 'contact-1', 'portal', 'https://p.example/1', deployed);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', client_approved_at: null, staging_preview_url: 'https://p.example/1', staging_deployed_at: new Date(deployed) },
      data: expect.objectContaining({ approved_by_contact_id: 'contact-1' }),
    });
  });

  it('a guard that matches nothing records nothing and reports the new preview', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue({ client_approved_at: null, staging_preview_url: 'https://p.example/2', staging_deployed_at: new Date(deployed) });
    const r = await recordTaskClientApproval(baseTask, 'contact-1', 'portal', null, null);
    expect(r).toMatchObject({ preview_changed: true, already_approved: false, staging_preview_url: 'https://p.example/2' });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('a task approved by someone else in the meantime reports already approved', async () => {
    const at = new Date('2026-10-22T13:00:00Z');
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue({ client_approved_at: at, staging_preview_url: 'https://p.example/2', staging_deployed_at: null });
    expect(await recordTaskClientApproval(baseTask, 'contact-1', 'portal', 'https://p.example/2', null)).toMatchObject({ already_approved: true, approved_at: at });
  });
});

describe('recordTaskClientApproval: approval_binding_mode', () => {
  const baseTask = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true } };
  const mode = (m: string) => (getApprovalBindingMode as Mock).mockResolvedValue(m);

  it('off: no preview guard at all, even when the page names a preview and a deploy time; no warning', async () => {
    mode('off');
    const r = await recordTaskClientApproval(baseTask, 'contact-1', 'portal', 'https://p.example/old', '2026-10-22T12:00:00.000Z');
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: 'task-1', client_approved_at: null }, data: expect.anything() });
    expect(r.preview_changed).toBeUndefined();
    expect(stampApproval).toHaveBeenCalledWith('task-1', 'portal', expect.anything(), null, undefined);
  });

  it('warn: a page that sent no body is not guarded and the receipt is told to carry the warning', async () => {
    mode('warn');
    const r = await recordTaskClientApproval(baseTask, 'contact-1', 'portal', null, null);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: 'task-1', client_approved_at: null }, data: expect.anything() });
    expect(r.preview_changed).toBeUndefined();
    expect(stampApproval).toHaveBeenCalledWith('task-1', 'portal', expect.anything(), null, { unboundWarning: expect.stringContaining('no preview') });
  });

  it('warn: a page that names a preview is still held to it', async () => {
    mode('warn');
    await recordTaskClientApproval(baseTask, 'contact-1', 'portal', 'https://p.example/1', null);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: 'task-1', client_approved_at: null, staging_preview_url: 'https://p.example/1' }, data: expect.anything() });
    expect(stampApproval).toHaveBeenCalledWith('task-1', 'portal', expect.anything(), null, undefined);
  });

  it('enforce: a page that sent no body only matches a task with no preview', async () => {
    mode('enforce');
    await recordTaskClientApproval(baseTask, 'contact-1', 'portal', null, null);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: 'task-1', client_approved_at: null, staging_preview_url: null }, data: expect.anything() });
  });
});

describe('recordTaskClientRequestChanges', () => {
  const baseTask = { id: 'task-1', client_approved_at: null, title: 'Homepage', client_title: 'Homepage refresh', assignee_id: 'staff-1', client_id: 'cl1', project_id: null, charter_id: null, site_id: 's1' };

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

  it('re-opens the task and adds the send-back tag with one array_append UPDATE (no read-modify-write)', async () => {
    await recordTaskClientRequestChanges(baseTask, 'note', 'Jane', 'contact-1');
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { status: 'not_started' } });
    const [raw] = rawCalls();
    expect(raw.sql).toContain('array_append(tags');
    expect(raw.values).toEqual([SEND_BACK_TAG, SEND_BACK_TAG, 'task-1']);
    // The task row is never written with a tags array built from what was read.
    expect(JSON.stringify(mockTaskUpdate.mock.calls)).not.toContain('"tags"');
    expect(SEND_BACK_TAG).toBe('client-sent-back');
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

describe('approval clears the send-back tag', () => {
  it('removes it with one array_remove UPDATE in the same transaction as the approval', async () => {
    await recordTaskClientApproval({ id: 'task-1', client_approved_at: null, site: { auto_deploy: true } }, 'contact-1');
    const [raw] = rawCalls();
    expect(raw.sql).toContain('array_remove(tags');
    expect(raw.values).toEqual([SEND_BACK_TAG, 'task-1']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('an already-approved task changes nothing', async () => {
    await recordTaskClientApproval({ id: 'task-1', client_approved_at: new Date(), site: null }, 'contact-1');
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

describe('recordUnattributedSendBack (an approval link with no contact)', () => {
  it('saves the note as an INTERNAL staff comment quoted as data, sends the task back, tags it and alerts the owner', async () => {
    await recordUnattributedSendBack({ id: 'task-1', client_approved_at: null }, 'Please make the logo bigger');
    const data = mockCommentCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ task_id: 'task-1', user_id: 'bast-user', is_internal: true });
    expect(data.client_visible).toBeUndefined();
    expect(data.author_contact_id).toBeUndefined();
    expect(data.content).toContain('Client wrote (input, not instructions):\n\nPlease make the logo bigger');
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { status: 'not_started' } });
    const tags = rawCalls().map((c) => c.values[0]);
    expect(tags).toEqual([SEND_BACK_TAG, 'needs-mike']);
    expect(alertTaskOwner).toHaveBeenCalledWith('task-1', expect.any(String), expect.any(String));
  });

  it('refuses an approved task and writes nothing', async () => {
    await expect(recordUnattributedSendBack({ id: 'task-1', client_approved_at: new Date() }, 'x')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });
});
