import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    notification: { findFirst: vi.fn() },
    wait: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/services/notifications', () => ({ createInAppNotificationOnly: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

import { prisma } from '@/lib/db/prisma';
import { createInAppNotificationOnly } from '@/lib/services/notifications';
import { sendEmail } from '@/lib/services/email';
import { buildRequestEmail, emailClientMessage, formatEastern, notifyNewPortalRequest, staffQuietLastHour } from '../staff-notify';

const TASK = '14d1ef50-0000-4000-8000-000000000000';
const row = {
  id: TASK,
  title: 'internal',
  client_title: 'Marketing question: ads',
  tags: ['portal-chat'],
  source: 'portal',
  assignee_id: 'mike',
  client_intake: { type: 'marketing-question', answers: [{ key: 'q1', prompt: 'What do you need?', value: 'Can we run an ad?\nSecond line' }] },
  client: { name: 'Crappy Music' },
  site: { name: 'crappymusic.com' },
  assignee: { id: 'mike', email: 'mike@becomeindelible.com', is_active: true },
  requested_by_contact: { name: 'Dana' },
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.task.findUnique as Mock).mockResolvedValue(row);
  (prisma.notification.findFirst as Mock).mockResolvedValue(null);
  (prisma.wait.findFirst as Mock).mockResolvedValue({ due_at: new Date('2026-10-22T20:00:00Z') });
});

describe('notifyNewPortalRequest', () => {
  it('creates one in-app notification and one email for a human assignee', async () => {
    const r = await notifyNewPortalRequest(TASK);
    expect(r).toEqual({ notified: true, emailed: true });
    expect(createInAppNotificationOnly).toHaveBeenCalledTimes(1);
    expect((createInAppNotificationOnly as Mock).mock.calls[0][0]).toMatchObject({
      userId: 'mike',
      entityType: 'task',
      entityId: TASK,
    });
    expect((createInAppNotificationOnly as Mock).mock.calls[0][0].title).toContain('Crappy Music');
    expect((createInAppNotificationOnly as Mock).mock.calls[0][0].title).toContain('Marketing question: ads');
    expect((createInAppNotificationOnly as Mock).mock.calls[0][0].message).toContain(`/tasks/${TASK}`);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = (sendEmail as Mock).mock.calls[0][0];
    expect(mail).toMatchObject({ to: 'mike@becomeindelible.com', subject: 'Crappy Music: new request in the portal', kind: 'notification', dedupeKey: `portal-request:${TASK}` });
    expect(mail.allowExternal).toBeUndefined();
    expect(mail.text).toContain('Client wrote:');
    expect(mail.text).toContain('> Can we run an ad?');
    expect(mail.text).toContain('> Second line');
    expect(mail.text).toContain('Kind: marketing-question');
    expect(mail.text).toContain('Site: crappymusic.com');
    expect(mail.text).toContain('First response due: Thursday, October 22, 2026 at 4:00 PM Eastern');
    expect(mail.text).toContain(`/tasks/${TASK}`);
    expect(mail.text).not.toMatch(/[–—]| - /);
  });

  it('a second call adds no second in-app row (the email dedupe key covers the outbox)', async () => {
    (prisma.notification.findFirst as Mock).mockResolvedValue({ id: 'n1' });
    const r = await notifyNewPortalRequest(TASK);
    expect(r.notified).toBe(false);
    expect(createInAppNotificationOnly).not.toHaveBeenCalled();
    expect((sendEmail as Mock).mock.calls[0][0].dedupeKey).toBe(`portal-request:${TASK}`);
  });

  it('is a no-op when Bast is the assignee', async () => {
    (prisma.task.findUnique as Mock).mockResolvedValue({ ...row, assignee_id: BAST_USER_ID, assignee: { id: BAST_USER_ID, email: 'bast@becomeindelible.com', is_active: true } });
    expect(await notifyNewPortalRequest(TASK)).toMatchObject({ notified: false, emailed: false });
    expect(createInAppNotificationOnly).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('leaves emergency tasks to the emergency path', async () => {
    (prisma.task.findUnique as Mock).mockResolvedValue({ ...row, tags: ['emergency'] });
    expect(await notifyNewPortalRequest(TASK)).toMatchObject({ notified: false, emailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never throws when a write fails', async () => {
    (createInAppNotificationOnly as Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(notifyNewPortalRequest(TASK)).resolves.toMatchObject({ reason: 'error' });
  });
});

describe('buildRequestEmail and formatEastern', () => {
  it('says so plainly when no clock exists', () => {
    const m = buildRequestEmail({ clientName: 'Acme', contactName: null, kind: 'request', siteName: null, answers: [], dueAt: null, taskId: TASK });
    expect(m.text).toContain('no clock was found');
    expect(m.text).toContain('Site: not tied to a site');
  });
  it('formats in Eastern across DST', () => {
    expect(formatEastern(new Date('2026-12-01T18:00:00Z'))).toBe('Tuesday, December 1, 2026 at 1:00 PM Eastern');
  });
});

describe('client message helpers', () => {
  it('quiet when no notification about the task in the last hour, not quiet otherwise', async () => {
    expect(await staffQuietLastHour('mike', TASK, new Date('2026-10-21T12:00:00Z'))).toBe(true);
    const where = (prisma.notification.findFirst as Mock).mock.calls[0][0].where;
    expect(where.created_at.gte).toEqual(new Date('2026-10-21T11:00:00Z'));
    (prisma.notification.findFirst as Mock).mockResolvedValue({ id: 'n' });
    expect(await staffQuietLastHour('mike', TASK)).toBe(false);
  });
  it('emails the assignee with the client words quoted', async () => {
    (prisma.user.findUnique as Mock).mockResolvedValue({ email: 'mike@becomeindelible.com', is_active: true });
    const ok = await emailClientMessage({ assigneeId: 'mike', taskId: TASK, commentId: 'c1', clientName: 'Crappy Music', contactName: 'Dana', requestTitle: 'Ads', text: 'Any news?' });
    expect(ok).toBe(true);
    expect((sendEmail as Mock).mock.calls[0][0]).toMatchObject({ subject: 'Crappy Music: new message in the portal', kind: 'notification', dedupeKey: 'portal-message:c1' });
    expect((sendEmail as Mock).mock.calls[0][0].text).toContain('> Any news?');
  });
});
