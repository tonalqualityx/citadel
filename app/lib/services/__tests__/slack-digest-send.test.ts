import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    slackNotice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    task: { findUnique: vi.fn() },
  },
}));
vi.mock('../slack', () => ({
  sendDirectMessage: vi.fn(),
  getSlackUserIdForUser: vi.fn(),
  trackSlackThread: vi.fn(),
  getSlackConfig: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { sendDirectMessage, getSlackUserIdForUser } from '../slack';
import { sendDueSlackDigests } from '../slack-notifications';

const notice = prisma.slackNotice as unknown as Record<string, Mock>;

const row = (id: string, user = 'u1') => ({
  id,
  user_id: user,
  sort: 'digest',
  notification_type: 'comment_added',
  title: `Line ${id}`,
  link: null,
  entity_type: 'task',
  created_at: new Date('2026-01-15T10:00:00Z'),
  sent_at: null,
});

describe('sendDueSlackDigests', () => {
  let sentAt: Date | null;

  beforeEach(() => {
    vi.clearAllMocks();
    sentAt = null;
    notice.findMany.mockImplementation(async () => (sentAt ? [] : [row('a'), row('b')]));
    notice.findFirst.mockImplementation(async () => (sentAt ? { sent_at: sentAt } : null));
    notice.updateMany.mockImplementation(async (args: { data: { sent_at: Date } }) => {
      sentAt = args.data.sent_at;
      return { count: 2 };
    });
    notice.deleteMany.mockResolvedValue({ count: 4 });
    (getSlackUserIdForUser as Mock).mockResolvedValue('S1');
    (sendDirectMessage as Mock).mockResolvedValue({ ok: true, ts: '1.2', channel: 'D1', text: 'posted' });
  });

  it('does not send before 9:00 Eastern', async () => {
    const r = await sendDueSlackDigests(new Date('2026-01-15T13:30:00Z'));
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ users: 1, sent: 0, items: 0 });
  });

  it('sends once after 9:00, stamps the rows, and not twice the same day', async () => {
    const r1 = await sendDueSlackDigests(new Date('2026-01-15T14:05:00Z'));
    expect(r1).toEqual({ users: 1, sent: 1, items: 2, skipped: 0, cleaned: 4 });
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(notice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: expect.objectContaining({ slack_ts: '1.2', slack_channel: 'D1', sent_at: expect.any(Date) }),
    });
    notice.findMany.mockImplementation(async () => [row('c')]); // a new line arrives later today
    const r2 = await sendDueSlackDigests(new Date('2026-01-15T16:00:00Z'));
    expect(r2.sent).toBe(0);
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves rows pending when Slack fails', async () => {
    (sendDirectMessage as Mock).mockResolvedValue({ ok: false, error: 'x' });
    const r = await sendDueSlackDigests(new Date('2026-01-15T14:05:00Z'));
    expect(r.sent).toBe(0);
    expect(notice.updateMany).not.toHaveBeenCalled();
  });

  it('stamps rows without a post when the user has no Slack mapping', async () => {
    (getSlackUserIdForUser as Mock).mockResolvedValue(null);
    const r = await sendDueSlackDigests(new Date('2026-01-15T14:05:00Z'));
    expect(r.skipped).toBe(1);
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(notice.updateMany).toHaveBeenCalledTimes(1);
  });
});
