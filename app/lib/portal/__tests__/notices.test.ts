import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: { findMany: vi.fn() },
    clientContact: { findMany: vi.fn(), findUnique: vi.fn() },
    client: { findUnique: vi.fn() },
    task: { count: vi.fn(), findUnique: vi.fn() },
    portalNotice: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from '@/lib/db/prisma';
import {
  buildNoticeBody,
  cancelStaleNotices,
  joinReplies,
  noticeRecipients,
  noticeRef,
  noticeSubject,
  NOTICE_REPLY_MAX_CHARS,
  queuePortalNotices,
  READ_THE_REST,
} from '../notices';
import { PROMISES } from '../intake/__tests__/promise-scan';

const p = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const TASK = { id: 'task-1', client_title: 'Site change: Update the hours', client_id: 'cl1', requested_by_contact_id: 'c1' };

describe('notice text (spec 3.4, writing standard 4b)', () => {
  const body = buildNoticeBody({ noticeId: '5f2d9c11-aaaa-4bbb-8ccc-0123456789ab', taskId: 'task-1', contactName: 'Dana Client', clientTitle: TASK.client_title, replies: ['We have updated them.'] });

  it('opens with the request it is about, then the reply, the link and the signature', () => {
    const lines = body.split('\n');
    expect(lines[0]).toBe('Hi Dana,');
    expect(lines[2]).toBe('There is a new reply on your request "Site change: Update the hours":');
    expect(body).toContain('We have updated them.');
    expect(body).toMatch(/https?:\/\/[^\s]+\/portal\/work\/task-1/);
    expect(body).toContain('You can reply in the portal. Replies to this email reach the team too.');
    expect(body).toContain('Indelible support');
    expect(body.trimEnd().endsWith('Ref: PN-5f2d9c11')).toBe(true);
  });

  it('subject names the request', () => expect(noticeSubject('Site change: hours')).toBe('New reply on your request: Site change: hours'));
  it('ref is PN- plus the first eight characters of the id', () => expect(noticeRef('5f2d9c11-aaaa')).toBe('PN-5f2d9c11'));
  it('falls back to "there" with no name', () => {
    expect(buildNoticeBody({ noticeId: 'abcdefgh1', taskId: 't', contactName: null, clientTitle: 'x', replies: ['y'] }).startsWith('Hi there,')).toBe(true);
  });

  it('cuts a long reply at 1,500 characters and points to the portal', () => {
    const long = 'word '.repeat(600);
    const out = buildNoticeBody({ noticeId: 'abcdefgh1', taskId: 't', contactName: 'Dana', clientTitle: 'x', replies: [long] });
    expect(joinReplies([long]).cut).toBe(true);
    expect(joinReplies([long]).text.length).toBeLessThanOrEqual(NOTICE_REPLY_MAX_CHARS);
    expect(out).toContain(`${READ_THE_REST}.`);
    expect(joinReplies(['short']).cut).toBe(false);
  });

  it('joins a burst as paragraphs', () => {
    expect(joinReplies(['one', ' two ']).text).toBe('one\n\ntwo');
  });

  it('fixed copy has no em or en dashes and makes no promise', () => {
    const fixed = body.replace('We have updated them.', '').replace(TASK.client_title, '');
    expect(fixed).not.toMatch(/[—–]/);
    for (const [name, re] of PROMISES) {
      // The only digits allowed are inside the ref and the url; strip those before scanning.
      const scan = fixed.replace(/https?:\/\/\S+/g, '').replace(/PN-\w+/g, '');
      expect(scan, name).not.toMatch(re);
    }
  });
});

describe('noticeRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    p.comment.findMany.mockResolvedValue([{ author_contact_id: 'c2' }]);
    p.client.findUnique.mockResolvedValue({ id: 'cl1', parent_agency_id: null });
    p.task.count.mockResolvedValue(1);
  });
  const contact = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@x.com`, client_id: 'cl1', portal_role: 'member', is_deleted: false, ...over });

  it('is the requester plus everyone who wrote in the thread', async () => {
    p.clientContact.findMany.mockResolvedValue([contact('c1'), contact('c2')]);
    const r = await noticeRecipients(TASK);
    expect(r.map((x) => x.id)).toEqual(['c1', 'c2']);
    const where = p.clientContact.findMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual(['c1', 'c2']);
    expect(where).toMatchObject({ is_deleted: false, client: { is_deleted: false } });
  });

  it('drops contacts with no address and contacts who cannot open the work page', async () => {
    p.clientContact.findMany.mockResolvedValue([contact('c1', { email: ' ' }), contact('c2')]);
    p.task.count.mockResolvedValue(0);
    expect(await noticeRecipients(TASK)).toEqual([]);
  });

  it('checks each contact against the work page rule with their own role', async () => {
    p.clientContact.findMany.mockResolvedValue([contact('c1', { portal_role: 'viewer' })]);
    await noticeRecipients(TASK);
    const where = p.task.count.mock.calls[0][0].where;
    expect(where.id).toBe('task-1');
    expect(JSON.stringify(where)).toContain('"client_id":"cl1"');
  });

  it('a contact on another client, and a task with no client, get nothing', async () => {
    p.clientContact.findMany.mockResolvedValue([contact('c1', { client_id: 'elsewhere' })]);
    p.task.count.mockResolvedValue(0);
    expect(await noticeRecipients(TASK)).toEqual([]);
    expect(await noticeRecipients({ ...TASK, client_id: null })).toEqual([]);
  });
});

describe('queuePortalNotices', () => {
  let tx: Record<string, any>;
  beforeEach(() => {
    vi.clearAllMocks();
    p.comment.findMany.mockResolvedValue([]);
    p.client.findUnique.mockResolvedValue({ id: 'cl1', parent_agency_id: null });
    p.task.count.mockResolvedValue(1);
    p.clientContact.findMany.mockResolvedValue([{ id: 'c1', name: 'Dana Client', email: 'dana@x.com', client_id: 'cl1', portal_role: 'member', is_deleted: false }]);
    tx = {
      $executeRaw: vi.fn(),
      portalNotice: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      comment: { findMany: vi.fn().mockResolvedValue([{ id: 'r1', content: 'First reply', created_at: new Date() }]) },
    };
    p.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  it('queues one notice per recipient with the fixed subject and body', async () => {
    const r = await queuePortalNotices(TASK, { id: 'r1' });
    expect(r).toEqual({ queued: 1, absorbed: 0 });
    const data = tx.portalNotice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ task_id: 'task-1', contact_id: 'c1', comment_ids: ['r1'], to_email: 'dana@x.com', subject: 'New reply on your request: Site change: Update the hours' });
    expect(data.body).toContain('First reply');
    expect(data.body).toContain(`Ref: ${noticeRef(data.id)}`);
    expect(data.status).toBeUndefined(); // the column default is queued
  });

  it('a still-queued notice for the same task and contact absorbs the new reply (one email per burst)', async () => {
    tx.portalNotice.findFirst
      .mockResolvedValueOnce(null) // not already carrying this comment
      .mockResolvedValueOnce({ id: 'n1', comment_ids: ['r0'], status: 'queued' });
    tx.comment.findMany.mockResolvedValue([
      { id: 'r0', content: 'Earlier reply', created_at: new Date(1) },
      { id: 'r1', content: 'Later reply', created_at: new Date(2) },
    ]);
    const r = await queuePortalNotices(TASK, { id: 'r1' });
    expect(r).toEqual({ queued: 0, absorbed: 1 });
    expect(tx.portalNotice.create).not.toHaveBeenCalled();
    const call = tx.portalNotice.updateMany.mock.calls[0][0];
    // Conditional on still being queued: a notice the sender claimed meanwhile is not touched.
    expect(call.where).toEqual({ id: 'n1', status: 'queued' });
    expect(call.data.comment_ids).toEqual(['r0', 'r1']);
    expect(call.data.body).toContain('Earlier reply\n\nLater reply');
  });

  it('if the sender claimed the notice between the read and the write, the reply gets a NEW notice', async () => {
    tx.portalNotice.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'n1', comment_ids: ['r0'], status: 'queued' });
    tx.portalNotice.updateMany.mockResolvedValue({ count: 0 }); // already 'sending'
    tx.comment.findMany.mockResolvedValue([{ id: 'r1', content: 'Late reply', created_at: new Date() }]);
    const r = await queuePortalNotices(TASK, { id: 'r1' });
    expect(r).toEqual({ queued: 1, absorbed: 0 });
    const data = tx.portalNotice.create.mock.calls[0][0].data;
    expect(data.comment_ids).toEqual(['r1']);
    expect(data.id).not.toBe('n1');
  });

  it('a reply already carried by a notice is not added twice', async () => {
    tx.portalNotice.findFirst.mockResolvedValueOnce({ id: 'n1' });
    expect(await queuePortalNotices(TASK, { id: 'r1' })).toEqual({ queued: 0, absorbed: 0 });
    expect(tx.portalNotice.create).not.toHaveBeenCalled();
  });

  it('queues nothing when nobody can see the task', async () => {
    p.task.count.mockResolvedValue(0);
    expect(await queuePortalNotices(TASK, { id: 'r1' })).toEqual({ queued: 0, absorbed: 0 });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it('serialises per task and contact with an advisory lock', async () => {
    await queuePortalNotices(TASK, { id: 'r1' });
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});

describe('cancelStaleNotices (the two-minute hold)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The per-notice work runs in a transaction; the mocked client doubles as the transaction.
    p.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(prisma));
    p.portalNotice.updateMany.mockResolvedValue({ count: 1 });
    p.task.findUnique.mockResolvedValue({ id: 't', title: 'T', client_title: 'Site change: hours', client_id: 'cl1', is_deleted: false, site: null });
    p.task.count.mockResolvedValue(1);
    p.clientContact.findUnique.mockResolvedValue({ id: 'c1', name: 'Dana', email: 'dana@x.com', client_id: 'cl1', portal_role: 'member', is_deleted: false });
    p.client.findUnique.mockResolvedValue({ id: 'cl1', parent_agency_id: null, is_deleted: false });
  });
  const queued = (over: Record<string, unknown> = {}) => ({
    id: 'n1', task_id: 't', contact_id: 'c1', comment_ids: ['r1', 'r2'], to_email: 'dana@x.com',
    subject: 'New reply on your request: Site change: hours', body: 'old', status: 'queued', ...over,
  });
  const list = (n: Record<string, unknown>) => {
    p.portalNotice.findMany.mockResolvedValue([n]);
    p.portalNotice.findUnique.mockResolvedValue(n);
  };

  it('cancels a notice whose replies were all unflagged or deleted', async () => {
    list(queued());
    p.comment.findMany.mockResolvedValue([]);
    expect(await cancelStaleNotices(new Date('2026-10-21T12:00:00Z'))).toBe(1);
    expect(p.portalNotice.updateMany).toHaveBeenCalledWith({ where: { id: 'n1', status: 'queued' }, data: { status: 'cancelled', cancelled_at: new Date('2026-10-21T12:00:00Z') } });
    expect(p.comment.findMany.mock.calls[0][0].where).toMatchObject({ is_deleted: false, is_internal: false, client_visible: true });
  });

  it('drops one withdrawn reply from a burst and rebuilds the body', async () => {
    list(queued());
    p.comment.findMany.mockResolvedValue([{ id: 'r2', content: 'Still shared', created_at: new Date() }]);
    expect(await cancelStaleNotices()).toBe(0);
    const data = p.portalNotice.updateMany.mock.calls[0][0].data;
    expect(data.comment_ids).toEqual(['r2']);
    expect(data.body).toContain('Still shared');
  });

  it('rewrites the body when a reply was edited, and leaves an unchanged notice alone', async () => {
    list(queued({ comment_ids: ['r1'] }));
    p.comment.findMany.mockResolvedValue([{ id: 'r1', content: 'Edited wording', created_at: new Date() }]);
    await cancelStaleNotices();
    expect(p.portalNotice.updateMany.mock.calls[0][0].data.body).toContain('Edited wording');

    p.portalNotice.updateMany.mockClear();
    const same = buildNoticeBody({ noticeId: 'n1', taskId: 't', contactName: 'Dana', clientTitle: 'Site change: hours', replies: ['Edited wording'] });
    list(queued({ comment_ids: ['r1'], body: same }));
    await cancelStaleNotices();
    expect(p.portalNotice.updateMany).not.toHaveBeenCalled();
  });

  it('cancels, and marks why, when the recipient no longer has access (revoked, deleted, project hidden)', async () => {
    list(queued({ comment_ids: ['r1'] }));
    p.comment.findMany.mockResolvedValue([{ id: 'r1', content: 'Reply', created_at: new Date() }]);
    p.task.count.mockResolvedValue(0);
    expect(await cancelStaleNotices()).toBe(1);
    expect(p.portalNotice.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'cancelled', send_error: expect.stringContaining('no longer has access') });
  });

  it('picks up an address change before the send', async () => {
    list(queued({ comment_ids: ['r1'], to_email: 'old@x.com' }));
    p.comment.findMany.mockResolvedValue([{ id: 'r1', content: 'Reply', created_at: new Date() }]);
    await cancelStaleNotices();
    expect(p.portalNotice.updateMany.mock.calls[0][0].data.to_email).toBe('dana@x.com');
  });

  it('works under the same advisory lock the queue uses', async () => {
    list(queued());
    p.comment.findMany.mockResolvedValue([]);
    await cancelStaleNotices();
    expect(p.$executeRaw).toHaveBeenCalled();
  });
});
