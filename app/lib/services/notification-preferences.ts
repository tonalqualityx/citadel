import { prisma } from '@/lib/db/prisma';
import { NotificationType } from '@prisma/client';

// Channel type for preferences
export type NotificationChannel = 'in_app' | 'email' | 'slack';

// Default preferences by notification type (smart defaults)
// In-app: all, Slack: high/critical events, Email: critical only
const DEFAULT_PREFERENCES: Record<
  NotificationType,
  { in_app: boolean; email: boolean; slack: boolean }
> = {
  task_assigned: { in_app: true, email: false, slack: true },
  task_status_changed: { in_app: true, email: false, slack: false },
  task_mentioned: { in_app: true, email: false, slack: true },
  task_due_soon: { in_app: true, email: true, slack: true },
  task_overdue: { in_app: true, email: true, slack: true },
  project_status_changed: { in_app: true, email: false, slack: false },
  review_requested: { in_app: true, email: false, slack: true },
  comment_added: { in_app: true, email: false, slack: true },
  retainer_alert: { in_app: true, email: true, slack: true },
  system_alert: { in_app: true, email: true, slack: true },
};

export interface NotificationPreferenceRow {
  notification_type: NotificationType;
  in_app: boolean;
  email: boolean;
  slack: boolean;
  admin_override: boolean;
  overridden_by_id: string | null;
  overridden_at: Date | null;
}

export interface PreferenceMatrix {
  preferences: NotificationPreferenceRow[];
  slackConnected: boolean;
}

/**
 * Get notification preferences for a specific user and notification type.
 * Returns defaults if no explicit preference exists.
 */
export async function getNotificationPreference(
  userId: string,
  type: NotificationType
): Promise<{ in_app: boolean; email: boolean; slack: boolean; admin_override: boolean }> {
  const pref = await prisma.notificationPreference.findUnique({
    where: {
      user_id_notification_type: {
        user_id: userId,
        notification_type: type,
      },
    },
  });

  if (pref) {
    return {
      in_app: pref.in_app,
      email: pref.email,
      slack: pref.slack,
      admin_override: pref.admin_override,
    };
  }

  // Return defaults
  return {
    ...DEFAULT_PREFERENCES[type],
    admin_override: false,
  };
}

/**
 * Get all notification preferences for a user as a matrix.
 */
export async function getAllPreferencesForUser(userId: string): Promise<PreferenceMatrix> {
  // Get existing preferences
  const existingPrefs = await prisma.notificationPreference.findMany({
    where: { user_id: userId },
  });

  // Check if user has Slack connected
  const slackMapping = await prisma.slackUserMapping.findUnique({
    where: { user_id: userId },
  });

  // Build full matrix with defaults for missing types
  const allTypes = Object.values(NotificationType) as NotificationType[];
  const preferences: NotificationPreferenceRow[] = allTypes.map((type) => {
    const existing = existingPrefs.find((p) => p.notification_type === type);
    if (existing) {
      return {
        notification_type: type,
        in_app: existing.in_app,
        email: existing.email,
        slack: existing.slack,
        admin_override: existing.admin_override,
        overridden_by_id: existing.overridden_by_id,
        overridden_at: existing.overridden_at,
      };
    }
    return {
      notification_type: type,
      ...DEFAULT_PREFERENCES[type],
      admin_override: false,
      overridden_by_id: null,
      overridden_at: null,
    };
  });

  return {
    preferences,
    slackConnected: !!slackMapping,
  };
}

/**
 * Set a single notification preference for a user.
 * Will not update if admin_override is set (unless force is true for admin actions).
 */
export async function setNotificationPreference(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
  enabled: boolean,
  force: boolean = false
): Promise<{ success: boolean; error?: string }> {
  // Check if there's an admin override
  const existing = await prisma.notificationPreference.findUnique({
    where: {
      user_id_notification_type: {
        user_id: userId,
        notification_type: type,
      },
    },
  });

  if (existing?.admin_override && !force) {
    return {
      success: false,
      error: 'This preference has been locked by an administrator',
    };
  }

  // Upsert the preference
  const updateData = { [channel]: enabled };

  await prisma.notificationPreference.upsert({
    where: {
      user_id_notification_type: {
        user_id: userId,
        notification_type: type,
      },
    },
    create: {
      user_id: userId,
      notification_type: type,
      ...DEFAULT_PREFERENCES[type],
      [channel]: enabled,
    },
    update: updateData,
  });

  return { success: true };
}

/**
 * Batch update multiple preferences for a user.
 */
export async function batchUpdatePreferences(
  userId: string,
  updates: Array<{
    notification_type: NotificationType;
    channel: NotificationChannel;
    enabled: boolean;
  }>,
  force: boolean = false
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const update of updates) {
    const result = await setNotificationPreference(
      userId,
      update.notification_type,
      update.channel,
      update.enabled,
      force
    );
    if (!result.success && result.error) {
      errors.push(`${update.notification_type}.${update.channel}: ${result.error}`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Admin: Override a user's notification preference (lock it).
 */
export async function adminOverridePreference(
  adminId: string,
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
  enabled: boolean
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: {
      user_id_notification_type: {
        user_id: userId,
        notification_type: type,
      },
    },
    create: {
      user_id: userId,
      notification_type: type,
      ...DEFAULT_PREFERENCES[type],
      [channel]: enabled,
      admin_override: true,
      overridden_by_id: adminId,
      overridden_at: new Date(),
    },
    update: {
      [channel]: enabled,
      admin_override: true,
      overridden_by_id: adminId,
      overridden_at: new Date(),
    },
  });
}

/**
 * Admin: Remove override (unlock) a preference.
 */
export async function adminRemoveOverride(
  userId: string,
  type: NotificationType
): Promise<void> {
  await prisma.notificationPreference.updateMany({
    where: {
      user_id: userId,
      notification_type: type,
    },
    data: {
      admin_override: false,
      overridden_by_id: null,
      overridden_at: null,
    },
  });
}

/**
 * Admin: Get preferences for any user (for admin UI).
 */
export async function adminGetUserPreferences(userId: string): Promise<PreferenceMatrix> {
  return getAllPreferencesForUser(userId);
}

/**
 * Initialize default preferences for a new user.
 * Called when a user is created to populate the matrix.
 */
export async function initializeDefaultPreferences(userId: string): Promise<void> {
  const allTypes = Object.values(NotificationType) as NotificationType[];

  await prisma.notificationPreference.createMany({
    data: allTypes.map((type) => ({
      user_id: userId,
      notification_type: type,
      ...DEFAULT_PREFERENCES[type],
    })),
    skipDuplicates: true,
  });
}

/**
 * Get default preferences (for displaying in UI without user context).
 */
export function getDefaultPreferences(): Record<
  NotificationType,
  { in_app: boolean; email: boolean; slack: boolean }
> {
  return { ...DEFAULT_PREFERENCES };
}

/**
 * Check if a user should receive a notification on a specific channel.
 * Used by the dispatcher to determine routing.
 */
export async function shouldNotifyOnChannel(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel
): Promise<boolean> {
  const pref = await getNotificationPreference(userId, type);
  return pref[channel];
}

/**
 * Get all channels that should receive a notification for a user/type.
 */
export async function getEnabledChannels(
  userId: string,
  type: NotificationType
): Promise<NotificationChannel[]> {
  const pref = await getNotificationPreference(userId, type);
  const channels: NotificationChannel[] = [];

  if (pref.in_app) channels.push('in_app');
  if (pref.email) channels.push('email');
  if (pref.slack) channels.push('slack');

  return channels;
}
