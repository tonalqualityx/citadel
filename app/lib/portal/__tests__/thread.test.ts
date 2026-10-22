import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn() },
    comment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/portal/waits', () => ({ onClientMessage: vi.fn(async () => ({ stopped: 0, flagged: 0, opened: null })) }));
vi.mock('@/lib/portal/staff-notify', () => ({ staffQuietLastHour: vi.fn(async () => true), emailClientMessage: vi.fn(async () => true) }));
vi.mock('@/lib/services/notifications', () => ({ createNotification: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { onClientMessage } from '@/lib/portal/waits';
import { emailClientMessage, staffQuietLastHour } from '@/lib/portal/staff-notify';
import { splitLinks } from '../linkify';
import {
  bastWordError,
  isThreadMessage,
  loadThread,
  MESSAGE_LIMITS,
  postClientMessage,
  STAFF_AUTHOR_NAME,
  threadCommentWhere,
  threadTaskWhere,
  toThreadMessage,
} from '../thread';
import { clientVisibleTaskWhere } from '../visibility';
import { taskAccessWhere, type PortalAccess } from '../access';

const access: PortalAccess = { contactId: 'c1', clientId: 'cl1', role: 'viewer' };
const TASK = '33333333-3333-4333-8333-333333333333';
const REF = '44444444-4444-4444-8444-444444444444';

describe('isThreadMessage (spec 3.2)', () => {
  it('shows what the client wrote', () => expect(isThreadMessage({ author_contact_id: 'c1' })).toBe(true));
  it('shows staff replies only when flagged client_visible', () => {
    expect(isThreadMessage({ client_visible: true })).toBe(true);
    expect(isThreadMessage({})).toBe(false);
    expect(isThreadMessage({ is_internal: false })).toBe(false);
  });
  it('shows older questions marked for the client', () => expect(isThreadMessage({ client_question: true })).toBe(true));
  it('hides deleted and internal comments whatever else is set', () => {
    expect(isThreadMessage({ is_deleted: true, client_visible: true })).toBe(false);
    expect(isThreadMessage({ is_internal: true, client_visible: true, author_contact_id: 'c1' })).toBe(false);
  });
  it('the Prisma twin says the same thing', () => {
    expect(threadCommentWhere()).toEqual({
      is_deleted: false,
      is_internal: false,
      OR: [{ author_contact_id: { not: null } }, { client_visible: true }, { client_question: true }],
    });
  });
});

describe('toThreadMessage', () => {
  it('signs every staff reply "Indelible", never a name', () => {
    const m = toThreadMessage({ id: 'a', content: 'hi', created_at: '2026-10-21T00:00:00Z', client_visible: true, author_contact_id: null }, ['c1']);
    expect(m.author).toEqual({ kind: 'staff', name: STAFF_AUTHOR_NAME });
    expect(JSON.stringify(m)).not.toMatch(/bast/i);
  });
  it('names the contact and marks their own', () => {
    const m = toThreadMessage({ id: 'a', content: 'hi', created_at: 'x', author_contact_id: 'c1', author_contact: { name: 'Dana' } }, ['c1']);
    expect(m).toMatchObject({ author: { kind: 'client', name: 'Dana' }, mine: true });
    expect(toThreadMessage({ id: 'a', content: 'hi', created_at: 'x', author_contact_id: 'c2', author_contact: { name: 'Eli' } }, ['c1']).mine).toBe(false);
  });
});

describe('bastWordError', () => {
  it('flags the whole word in any case', () => {
    expect(bastWordError('Bast did it')).toMatch(/Bast/);
    expect(bastWordError('BAST')).toBeTruthy();
    expect(bastWordError('bastion')).toBeNull();
  });
  it('folds look-alikes before looking: fullwidth, zero-width, soft hyphen, word joiner, bidi marks', () => {
    for (const t of ['\uFF22\uFF41\uFF53\uFF54', 'B\u200Bast', 'B\u200Dast', 'Ba\u00ADst', 'B\u2060ast', '\uFEFFBast', 'Ba\u202Est', 'B\u034Fast']) {
      expect(bastWordError(`Thanks, ${t}.`), JSON.stringify(t)).toBeTruthy();
    }
    expect(bastWordError('Bas\u200Btion')).toBeNull(); // folds to "Bastion", still not the name
  });
});

describe('threadTaskWhere', () => {
  it('is the work page rule: client scope, client-visible, contact access', () => {
    expect(threadTaskWhere(access, TASK)).toEqual({
      id: TASK,
      is_deleted: false,
      AND: [{ OR: [{ client_id: 'cl1' }, { site: { client_id: 'cl1' } }] }, clientVisibleTaskWhere(), taskAccessWhere(access)],
    });
  });
});

describe('loadThread', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns null (404) when the task is not visible, and reads no comments', async () => {
    (prisma.task.findFirst as Mock).mockResolvedValue(null);
    expect(await loadThread(access, TASK)).toBeNull();
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });
  it('reads only thread comments, oldest first, after a cursor when given', async () => {
    (prisma.task.findFirst as Mock).mockResolvedValue({ id: TASK });
    (prisma.comment.findMany as Mock).mockResolvedValue([
      { id: 'a', content: 'q', created_at: new Date('2026-10-21T10:00:00Z'), author_contact_id: null },
    ]);
    const after = new Date('2026-10-21T09:00:00Z');
    const out = await loadThread(access, TASK, { after });
    expect(out).toHaveLength(1);
    const arg = (prisma.comment.findMany as Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ task_id: TASK, AND: [threadCommentWhere(), { created_at: { gt: after } }] });
    expect(arg.orderBy).toEqual({ created_at: 'asc' });
    expect(Object.keys(arg.select).sort()).toEqual(['author_contact', 'author_contact_id', 'content', 'created_at', 'id']);
  });
});

describe('postClientMessage', () => {
  const taskRow = { id: TASK, title: 'Internal title', client_title: 'Site change: hours', assignee_id: 'staff-1', client_id: 'cl1', project_id: null, charter_id: null, site_id: 's1' };
  let comment: Record<string, Mock>;
  let tx: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    comment = { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), create: vi.fn() };
    comment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'm1', task_id: TASK, content: data.content, created_at: new Date('2026-10-21T10:00:00Z'), author_contact_id: data.author_contact_id, author_contact: { name: 'Dana' },
    }));
    tx = { $executeRaw: vi.fn(), task: { findFirst: vi.fn().mockResolvedValue(taskRow) }, comment };
    (prisma.$transaction as Mock).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  const post = (text = ' Please use  this photo\n https://example.com/a.jpg ') =>
    postClientMessage(access, { id: 'c1', name: 'Dana' }, TASK, { client_ref: REF, text });

  it('writes the contact-authored, client-visible, non-internal comment with the text verbatim', async () => {
    const r = await post();
    expect(r.created).toBe(true);
    expect(comment.create.mock.calls[0][0].data).toEqual({
      task_id: TASK,
      user_id: null, // the client is the author; no staff or bot user is attached
      content: ' Please use  this photo\n https://example.com/a.jpg ',
      is_internal: false,
      client_visible: true,
      author_contact_id: 'c1',
      client_ref: REF,
    });
    expect(r.message).toMatchObject({ author: { kind: 'client', name: 'Dana' }, mine: true });
  });

  it('runs the wait effects in the same transaction and alerts the assignee in-app after it', async () => {
    await post();
    expect(onClientMessage).toHaveBeenCalledWith(tx, expect.objectContaining({ id: TASK, client_title: 'Site change: hours' }), { contact_ids: ['c1'], comment_id: 'm1' }, expect.any(Date));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'staff-1', type: 'comment_added', entityId: TASK }));
  });

  it('emails the assignee when nothing about the task reached them in the last hour', async () => {
    await post();
    expect(emailClientMessage).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'staff-1', taskId: TASK, commentId: 'm1', contactName: 'Dana' }));
  });

  it('sends no email when the assignee was notified about the task within the hour', async () => {
    (staffQuietLastHour as Mock).mockResolvedValueOnce(false);
    await post();
    expect(createNotification).toHaveBeenCalled();
    expect(emailClientMessage).not.toHaveBeenCalled();
  });

  it('does not alert Bast as assignee', async () => {
    tx.task.findFirst.mockResolvedValue({ ...taskRow, assignee_id: BAST_USER_ID });
    await post();
    expect(createNotification).not.toHaveBeenCalled();
    expect(emailClientMessage).not.toHaveBeenCalled();
  });

  it('a repeat client_ref is a no-op: same message, 200, no write, no effects', async () => {
    comment.findUnique.mockResolvedValue({ id: 'm1', task_id: TASK, content: 'x', created_at: new Date(), author_contact_id: 'c1', author_contact: { name: 'Dana' } });
    const r = await post('x');
    expect(r.created).toBe(false);
    expect(comment.create).not.toHaveBeenCalled();
    expect(onClientMessage).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("someone else's client_ref, or another task's, is a 404", async () => {
    comment.findUnique.mockResolvedValue({ id: 'm1', task_id: TASK, content: 'x', created_at: new Date(), author_contact_id: 'other', author_contact: null });
    await expect(post('x')).rejects.toMatchObject({ statusCode: 404 });
    comment.findUnique.mockResolvedValue({ id: 'm1', task_id: 'another', content: 'x', created_at: new Date(), author_contact_id: 'c1', author_contact: null });
    await expect(post('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s a task the contact may not see', async () => {
    tx.task.findFirst.mockResolvedValue(null);
    await expect(post()).rejects.toMatchObject({ statusCode: 404 });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it('a revoked contact is a 404 before any query', async () => {
    await expect(postClientMessage({ ...access, revoked: true }, { id: 'c1', name: null }, TASK, { client_ref: REF, text: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects empty and over-long text', async () => {
    await expect(post('   ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(post('x'.repeat(4001))).rejects.toMatchObject({ statusCode: 400 });
    await expect(post('x'.repeat(4000))).resolves.toBeTruthy();
  });

  it('rate limits per person from the database: 120 an hour, 200 a day, and names the limiter', async () => {
    expect(MESSAGE_LIMITS).toEqual({ per_hour: 120, per_day: 200 });
    comment.count.mockResolvedValueOnce(MESSAGE_LIMITS.per_hour).mockResolvedValueOnce(0);
    const err = await post().catch((e) => e);
    expect(err).toMatchObject({ statusCode: 429, limit: 'messages_per_hour', message: 'You have sent a lot in a short time. Please try again in a few minutes.' });
    expect(err.message).not.toContain('support@');
    comment.count.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(MESSAGE_LIMITS.per_day);
    await expect(post()).rejects.toMatchObject({ statusCode: 429, limit: 'messages_per_day' });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it('counts every contact row the person holds', async () => {
    await postClientMessage({ ...access, contactIds: ['c1', 'c1b'] }, { id: 'c1', name: 'Dana' }, TASK, { client_ref: REF, text: 'x' });
    expect(comment.count.mock.calls[0][0].where.author_contact_id).toEqual({ in: ['c1', 'c1b'] });
  });
});

describe('splitLinks', () => {
  it('links http(s) urls and leaves the rest as plain text', () => {
    expect(splitLinks('See https://a.com/x, then <b>no</b>.')).toEqual([
      { text: 'See ', href: null },
      { text: 'https://a.com/x', href: 'https://a.com/x' },
      { text: ', then <b>no</b>.', href: null },
    ]);
  });
  it('never links javascript: or other schemes', () => {
    expect(splitLinks('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x', href: null }]);
  });
  it('plain text is one segment', () => expect(splitLinks('hello')).toEqual([{ text: 'hello', href: null }]));
});
