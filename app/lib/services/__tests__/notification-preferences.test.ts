import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationType } from '@prisma/client';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    slackUserMapping: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import {
  getNotificationPreference,
  getAllPreferencesForUser,
  setNotificationPreference,
  batchUpdatePreferences,
  adminOverridePreference,
  adminRemoveOverride,
  getDefaultPreferences,
  shouldNotifyOnChannel,
  getEnabledChannels,
} from '../notification-preferences';
import type { Mock } from 'vitest';

const mockPrefFindUnique = prisma.notificationPreference.findUnique as Mock;
const mockPrefFindMany = prisma.notificationPreference.findMany as Mock;
const mockPrefUpsert = prisma.notificationPreference.upsert as Mock;
const mockPrefUpdateMany = prisma.notificationPreference.updateMany as Mock;
const mockSlackMappingFindUnique = prisma.slackUserMapping.findUnique as Mock;

const TEST_USER_ID = 'user-123';
const TEST_ADMIN_ID = 'admin-456';

describe('notification-preferences service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNotificationPreference', () => {
    it('returns stored preference when it exists', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: false,
        email: true,
        slack: true,
        admin_override: false,
      });

      const result = await getNotificationPreference(TEST_USER_ID, 'task_assigned');

      expect(result).toEqual({
        in_app: false,
        email: true,
        slack: true,
        admin_override: false,
      });
      expect(mockPrefFindUnique).toHaveBeenCalledWith({
        where: {
          user_id_notification_type: {
            user_id: TEST_USER_ID,
            notification_type: 'task_assigned',
          },
        },
      });
    });

    it('returns default preferences when no stored preference exists', async () => {
      mockPrefFindUnique.mockResolvedValue(null);

      const result = await getNotificationPreference(TEST_USER_ID, 'task_assigned');

      // Default for task_assigned: in_app: true, email: false, slack: true
      expect(result).toEqual({
        in_app: true,
        email: false,
        slack: true,
        admin_override: false,
      });
    });

    it('returns correct defaults for different notification types', async () => {
      mockPrefFindUnique.mockResolvedValue(null);

      // task_status_changed default: in_app only
      const result1 = await getNotificationPreference(TEST_USER_ID, 'task_status_changed');
      expect(result1).toEqual({
        in_app: true,
        email: false,
        slack: false,
        admin_override: false,
      });

      // system_alert default: all channels
      const result2 = await getNotificationPreference(TEST_USER_ID, 'system_alert');
      expect(result2).toEqual({
        in_app: true,
        email: true,
        slack: true,
        admin_override: false,
      });
    });
  });

  describe('getAllPreferencesForUser', () => {
    it('returns matrix with all notification types', async () => {
      mockPrefFindMany.mockResolvedValue([]);
      mockSlackMappingFindUnique.mockResolvedValue(null);

      const result = await getAllPreferencesForUser(TEST_USER_ID);

      // Should have all 10 notification types
      expect(result.preferences).toHaveLength(10);
      expect(result.slackConnected).toBe(false);

      // Verify it includes all types
      const types = result.preferences.map((p) => p.notification_type);
      expect(types).toContain('task_assigned');
      expect(types).toContain('task_status_changed');
      expect(types).toContain('system_alert');
    });

    it('merges stored preferences with defaults', async () => {
      mockPrefFindMany.mockResolvedValue([
        {
          notification_type: 'task_assigned',
          in_app: false,
          email: true,
          slack: false,
          admin_override: true,
          overridden_by_id: TEST_ADMIN_ID,
          overridden_at: new Date('2024-01-01'),
        },
      ]);
      mockSlackMappingFindUnique.mockResolvedValue(null);

      const result = await getAllPreferencesForUser(TEST_USER_ID);

      // Find task_assigned preference
      const taskAssigned = result.preferences.find(
        (p) => p.notification_type === 'task_assigned'
      );
      expect(taskAssigned).toEqual({
        notification_type: 'task_assigned',
        in_app: false,
        email: true,
        slack: false,
        admin_override: true,
        overridden_by_id: TEST_ADMIN_ID,
        overridden_at: expect.any(Date),
      });

      // Other types should have defaults
      const taskMentioned = result.preferences.find(
        (p) => p.notification_type === 'task_mentioned'
      );
      expect(taskMentioned?.in_app).toBe(true);
      expect(taskMentioned?.admin_override).toBe(false);
    });

    it('reports slack as connected when mapping exists', async () => {
      mockPrefFindMany.mockResolvedValue([]);
      mockSlackMappingFindUnique.mockResolvedValue({
        user_id: TEST_USER_ID,
        slack_user_id: 'U12345',
        slack_team_id: 'T12345',
      });

      const result = await getAllPreferencesForUser(TEST_USER_ID);

      expect(result.slackConnected).toBe(true);
    });
  });

  describe('setNotificationPreference', () => {
    it('updates preference when not admin-locked', async () => {
      mockPrefFindUnique.mockResolvedValue(null);
      mockPrefUpsert.mockResolvedValue({});

      const result = await setNotificationPreference(
        TEST_USER_ID,
        'task_assigned',
        'email',
        true
      );

      expect(result.success).toBe(true);
      expect(mockPrefUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { email: true },
        })
      );
    });

    it('rejects update when admin-locked', async () => {
      mockPrefFindUnique.mockResolvedValue({
        admin_override: true,
      });

      const result = await setNotificationPreference(
        TEST_USER_ID,
        'task_assigned',
        'email',
        true
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('locked by an administrator');
      expect(mockPrefUpsert).not.toHaveBeenCalled();
    });

    it('allows force update even when admin-locked', async () => {
      mockPrefFindUnique.mockResolvedValue({
        admin_override: true,
      });
      mockPrefUpsert.mockResolvedValue({});

      const result = await setNotificationPreference(
        TEST_USER_ID,
        'task_assigned',
        'email',
        true,
        true // force
      );

      expect(result.success).toBe(true);
      expect(mockPrefUpsert).toHaveBeenCalled();
    });

    it('creates preference with defaults when none exists', async () => {
      mockPrefFindUnique.mockResolvedValue(null);
      mockPrefUpsert.mockResolvedValue({});

      await setNotificationPreference(TEST_USER_ID, 'task_assigned', 'slack', false);

      expect(mockPrefUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            user_id: TEST_USER_ID,
            notification_type: 'task_assigned',
            in_app: true, // default
            email: false, // default
            slack: false, // our override
          }),
        })
      );
    });
  });

  describe('batchUpdatePreferences', () => {
    it('updates multiple preferences successfully', async () => {
      mockPrefFindUnique.mockResolvedValue(null);
      mockPrefUpsert.mockResolvedValue({});

      const result = await batchUpdatePreferences(TEST_USER_ID, [
        { notification_type: 'task_assigned', channel: 'email', enabled: true },
        { notification_type: 'comment_added', channel: 'slack', enabled: false },
      ]);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockPrefUpsert).toHaveBeenCalledTimes(2);
    });

    it('collects errors for locked preferences', async () => {
      mockPrefFindUnique.mockResolvedValue({ admin_override: true });

      const result = await batchUpdatePreferences(TEST_USER_ID, [
        { notification_type: 'task_assigned', channel: 'email', enabled: true },
        { notification_type: 'comment_added', channel: 'slack', enabled: false },
      ]);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('task_assigned.email');
    });
  });

  describe('adminOverridePreference', () => {
    it('sets preference with admin override flag', async () => {
      mockPrefUpsert.mockResolvedValue({});

      await adminOverridePreference(
        TEST_ADMIN_ID,
        TEST_USER_ID,
        'task_assigned',
        'slack',
        false
      );

      expect(mockPrefUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            slack: false,
            admin_override: true,
            overridden_by_id: TEST_ADMIN_ID,
            overridden_at: expect.any(Date),
          }),
        })
      );
    });
  });

  describe('adminRemoveOverride', () => {
    it('removes admin override flag', async () => {
      mockPrefUpdateMany.mockResolvedValue({ count: 1 });

      await adminRemoveOverride(TEST_USER_ID, 'task_assigned');

      expect(mockPrefUpdateMany).toHaveBeenCalledWith({
        where: {
          user_id: TEST_USER_ID,
          notification_type: 'task_assigned',
        },
        data: {
          admin_override: false,
          overridden_by_id: null,
          overridden_at: null,
        },
      });
    });
  });

  describe('getDefaultPreferences', () => {
    it('returns default preferences for all types', () => {
      const defaults = getDefaultPreferences();

      // Check some expected defaults
      expect(defaults.task_assigned).toEqual({
        in_app: true,
        email: false,
        slack: true,
      });
      expect(defaults.system_alert).toEqual({
        in_app: true,
        email: true,
        slack: true,
      });
      expect(defaults.task_status_changed).toEqual({
        in_app: true,
        email: false,
        slack: false,
      });
    });
  });

  describe('shouldNotifyOnChannel', () => {
    it('returns true when channel is enabled', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: true,
        email: false,
        slack: true,
        admin_override: false,
      });

      expect(await shouldNotifyOnChannel(TEST_USER_ID, 'task_assigned', 'in_app')).toBe(true);
      expect(await shouldNotifyOnChannel(TEST_USER_ID, 'task_assigned', 'slack')).toBe(true);
    });

    it('returns false when channel is disabled', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: true,
        email: false,
        slack: true,
        admin_override: false,
      });

      expect(await shouldNotifyOnChannel(TEST_USER_ID, 'task_assigned', 'email')).toBe(false);
    });
  });

  describe('getEnabledChannels', () => {
    it('returns all enabled channels', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: true,
        email: true,
        slack: false,
        admin_override: false,
      });

      const channels = await getEnabledChannels(TEST_USER_ID, 'task_assigned');

      expect(channels).toEqual(['in_app', 'email']);
    });

    it('returns empty array when all channels disabled', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: false,
        email: false,
        slack: false,
        admin_override: false,
      });

      const channels = await getEnabledChannels(TEST_USER_ID, 'task_assigned');

      expect(channels).toEqual([]);
    });

    it('returns all channels when all enabled', async () => {
      mockPrefFindUnique.mockResolvedValue({
        in_app: true,
        email: true,
        slack: true,
        admin_override: false,
      });

      const channels = await getEnabledChannels(TEST_USER_ID, 'system_alert');

      expect(channels).toEqual(['in_app', 'email', 'slack']);
    });
  });
});
