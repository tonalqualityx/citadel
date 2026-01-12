import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationType, NotificationPriority } from '@prisma/client';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    emailDigestQueue: {
      create: vi.fn(),
    },
  },
}));

// Mock notification-preferences
vi.mock('../notification-preferences', () => ({
  getNotificationPreference: vi.fn(),
}));

// Mock email-notifications
vi.mock('../email-notifications', () => ({
  sendNotificationEmail: vi.fn(),
}));

// Mock slack-notifications
vi.mock('../slack-notifications', () => ({
  sendSlackNotification: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { getNotificationPreference } from '../notification-preferences';
import { sendNotificationEmail } from '../email-notifications';
import { sendSlackNotification as sendSlack } from '../slack-notifications';
import { dispatchNotification, dispatchNotificationToMany } from '../notification-dispatcher';
import type { Mock } from 'vitest';

const mockGetPreference = getNotificationPreference as Mock;
const mockSendEmail = sendNotificationEmail as Mock;
const mockSendSlack = sendSlack as Mock;
const mockNotificationCreate = prisma.notification.create as Mock;
const mockNotificationUpdate = prisma.notification.update as Mock;
const mockNotificationFindFirst = prisma.notification.findFirst as Mock;
const mockEmailDigestCreate = prisma.emailDigestQueue.create as Mock;

const TEST_USER_ID = 'user-123';
const TEST_NOTIFICATION_ID = 'notif-456';

const baseOptions = {
  userId: TEST_USER_ID,
  type: 'task_assigned' as NotificationType,
  title: 'You have a new task',
  message: 'Task details here',
  entityType: 'task',
  entityId: 'task-789',
};

describe('notification-dispatcher service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockGetPreference.mockResolvedValue({
      in_app: true,
      email: true,
      slack: true,
      admin_override: false,
    });

    mockNotificationCreate.mockResolvedValue({ id: TEST_NOTIFICATION_ID });
    mockNotificationUpdate.mockResolvedValue({ id: TEST_NOTIFICATION_ID });
    mockNotificationFindFirst.mockResolvedValue(null);
    mockEmailDigestCreate.mockResolvedValue({});
    mockSendEmail.mockResolvedValue(true);
    mockSendSlack.mockResolvedValue(true);
  });

  describe('dispatchNotification', () => {
    describe('priority routing', () => {
      it('sends critical notifications immediately to all enabled channels', async () => {
        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.sent).toBe(true);
        expect(result.email.queued).toBe(false);
        expect(result.slack.sent).toBe(true);
        expect(mockSendEmail).toHaveBeenCalled();
        expect(mockSendSlack).toHaveBeenCalled();
      });

      it('sends high priority notifications immediately to all enabled channels', async () => {
        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'high',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.sent).toBe(true);
        expect(result.slack.sent).toBe(true);
        expect(mockSendEmail).toHaveBeenCalled();
      });

      it('queues normal priority email for digest', async () => {
        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'normal',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.sent).toBe(false);
        expect(result.email.queued).toBe(true);
        expect(result.slack.sent).toBe(true);
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockEmailDigestCreate).toHaveBeenCalled();
      });

      it('skips Slack for low priority notifications', async () => {
        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'low',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.queued).toBe(true);
        expect(result.slack.sent).toBe(false);
        expect(mockSendSlack).not.toHaveBeenCalled();
      });

      it('defaults to normal priority when not specified', async () => {
        const result = await dispatchNotification({
          ...baseOptions,
          // No priority specified
        });

        expect(result.email.queued).toBe(true);
        expect(mockSendEmail).not.toHaveBeenCalled();
      });
    });

    describe('user preferences', () => {
      it('respects disabled in-app preference', async () => {
        mockGetPreference.mockResolvedValue({
          in_app: false,
          email: true,
          slack: true,
          admin_override: false,
        });

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.inApp.sent).toBe(false);
        expect(mockNotificationCreate).not.toHaveBeenCalled();
      });

      it('respects disabled email preference', async () => {
        mockGetPreference.mockResolvedValue({
          in_app: true,
          email: false,
          slack: true,
          admin_override: false,
        });

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.email.sent).toBe(false);
        expect(mockSendEmail).not.toHaveBeenCalled();
      });

      it('respects disabled Slack preference', async () => {
        mockGetPreference.mockResolvedValue({
          in_app: true,
          email: true,
          slack: false,
          admin_override: false,
        });

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.slack.sent).toBe(false);
        expect(mockSendSlack).not.toHaveBeenCalled();
      });

      it('handles all channels disabled', async () => {
        mockGetPreference.mockResolvedValue({
          in_app: false,
          email: false,
          slack: false,
          admin_override: false,
        });

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.inApp.sent).toBe(false);
        expect(result.email.sent).toBe(false);
        expect(result.slack.sent).toBe(false);
      });
    });

    describe('notification bundling', () => {
      it('creates new notification when no bundle key', async () => {
        await dispatchNotification({
          ...baseOptions,
          bundleKey: undefined,
        });

        expect(mockNotificationCreate).toHaveBeenCalled();
        expect(mockNotificationFindFirst).not.toHaveBeenCalled();
      });

      it('creates new notification when no existing bundle', async () => {
        mockNotificationFindFirst.mockResolvedValue(null);

        await dispatchNotification({
          ...baseOptions,
          bundleKey: 'task-comments-789',
        });

        expect(mockNotificationFindFirst).toHaveBeenCalled();
        expect(mockNotificationCreate).toHaveBeenCalled();
      });

      it('updates existing bundle instead of creating new', async () => {
        mockNotificationFindFirst.mockResolvedValue({
          id: 'existing-bundle-id',
          bundle_count: 2,
          title: 'New comment',
        });

        await dispatchNotification({
          ...baseOptions,
          bundleKey: 'task-comments-789',
        });

        expect(mockNotificationUpdate).toHaveBeenCalledWith({
          where: { id: 'existing-bundle-id' },
          data: expect.objectContaining({
            bundle_count: 3,
            title: expect.stringContaining('(3)'),
          }),
        });
        expect(mockNotificationCreate).not.toHaveBeenCalled();
      });
    });

    describe('delivery tracking', () => {
      it('updates notification when email sent successfully', async () => {
        mockSendEmail.mockResolvedValue(true);

        await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(mockNotificationUpdate).toHaveBeenCalledWith({
          where: { id: TEST_NOTIFICATION_ID },
          data: expect.objectContaining({
            email_sent: true,
            email_sent_at: expect.any(Date),
          }),
        });
      });

      it('updates notification when Slack sent successfully', async () => {
        mockSendSlack.mockResolvedValue(true);

        await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(mockNotificationUpdate).toHaveBeenCalledWith({
          where: { id: TEST_NOTIFICATION_ID },
          data: expect.objectContaining({
            slack_sent: true,
            slack_sent_at: expect.any(Date),
          }),
        });
      });

      it('does not track delivery when send fails', async () => {
        mockSendEmail.mockResolvedValue(false);
        mockSendSlack.mockResolvedValue(false);

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        // Only called once for in-app, not for failed email/slack
        expect(mockNotificationUpdate).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ email_sent: true }),
          })
        );
      });
    });

    describe('error handling', () => {
      it('continues despite email failure', async () => {
        mockSendEmail.mockRejectedValue(new Error('SMTP error'));

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.sent).toBe(false);
        expect(result.slack.sent).toBe(true);
      });

      it('continues despite Slack failure', async () => {
        mockSendSlack.mockRejectedValue(new Error('Slack API error'));

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'critical',
        });

        expect(result.inApp.sent).toBe(true);
        expect(result.email.sent).toBe(true);
        expect(result.slack.sent).toBe(false);
      });

      it('handles digest queue failure', async () => {
        mockEmailDigestCreate.mockRejectedValue(new Error('DB error'));

        const result = await dispatchNotification({
          ...baseOptions,
          priority: 'normal',
        });

        expect(result.email.queued).toBe(false);
        expect(result.email.error).toBe('Failed to queue');
      });
    });
  });

  describe('dispatchNotificationToMany', () => {
    it('dispatches to multiple users', async () => {
      const userIds = ['user-1', 'user-2', 'user-3'];

      const results = await dispatchNotificationToMany(userIds, {
        type: 'system_alert',
        title: 'System maintenance',
        priority: 'critical',
      });

      expect(results.size).toBe(3);
      expect(mockNotificationCreate).toHaveBeenCalledTimes(3);
    });

    it('returns results for each user', async () => {
      const userIds = ['user-1', 'user-2'];

      const results = await dispatchNotificationToMany(userIds, {
        type: 'task_assigned',
        title: 'New assignment',
        priority: 'high',
      });

      expect(results.get('user-1')).toBeDefined();
      expect(results.get('user-2')).toBeDefined();
      expect(results.get('user-1')?.inApp.sent).toBe(true);
    });
  });
});
