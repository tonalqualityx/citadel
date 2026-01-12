import { prisma } from '@/lib/db/prisma';
import { NotificationType, NotificationPriority } from '@prisma/client';
import {
  getNotificationPreference,
  NotificationChannel,
} from './notification-preferences';

export interface DispatchOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  bundleKey?: string;
  priority?: NotificationPriority;
  metadata?: Record<string, unknown>;
}

export interface DispatchResult {
  inApp: { sent: boolean; notificationId?: string };
  email: { sent: boolean; queued?: boolean; error?: string };
  slack: { sent: boolean; error?: string };
}

/**
 * Determine which channels should receive the notification
 * based on user preferences and priority.
 */
async function determineChannels(
  userId: string,
  type: NotificationType,
  priority: NotificationPriority
): Promise<{ inApp: boolean; email: boolean; slack: boolean; emailImmediate: boolean }> {
  const prefs = await getNotificationPreference(userId, type);

  // Critical: All enabled channels immediately
  if (priority === 'critical') {
    return {
      inApp: prefs.in_app,
      email: prefs.email,
      slack: prefs.slack,
      emailImmediate: true,
    };
  }

  // High: All enabled channels immediately
  if (priority === 'high') {
    return {
      inApp: prefs.in_app,
      email: prefs.email,
      slack: prefs.slack,
      emailImmediate: true,
    };
  }

  // Normal: In-app + Slack immediate, email goes to digest
  if (priority === 'normal') {
    return {
      inApp: prefs.in_app,
      email: prefs.email, // Will be queued, not immediate
      slack: prefs.slack,
      emailImmediate: false,
    };
  }

  // Low: In-app only immediate, email to digest, no Slack
  return {
    inApp: prefs.in_app,
    email: prefs.email,
    slack: false,
    emailImmediate: false,
  };
}

/**
 * Create the in-app notification with bundling support.
 */
async function createInAppNotification(
  options: DispatchOptions
): Promise<{ id: string } | null> {
  const { userId, type, title, message, entityType, entityId, bundleKey, priority } =
    options;

  // If bundling, check for existing recent notification with same bundle key
  if (bundleKey) {
    const existingBundle = await prisma.notification.findFirst({
      where: {
        user_id: userId,
        bundle_key: bundleKey,
        is_read: false,
        created_at: {
          gte: new Date(Date.now() - 30 * 60 * 1000), // Last 30 minutes
        },
      },
    });

    if (existingBundle) {
      // Update bundle count instead of creating new
      const updated = await prisma.notification.update({
        where: { id: existingBundle.id },
        data: {
          bundle_count: existingBundle.bundle_count + 1,
          title: `${title.replace(/ \(\d+\)$/, '')} (${existingBundle.bundle_count + 1})`,
          created_at: new Date(), // Bump to top
        },
      });
      return { id: updated.id };
    }
  }

  const notification = await prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      message,
      entity_type: entityType,
      entity_id: entityId,
      bundle_key: bundleKey,
      priority: priority || 'normal',
    },
  });

  return { id: notification.id };
}

/**
 * Queue notification for email digest (non-critical).
 */
async function queueForEmailDigest(options: DispatchOptions): Promise<void> {
  await prisma.emailDigestQueue.create({
    data: {
      user_id: options.userId,
      notification_type: options.type,
      title: options.title,
      message: options.message,
      entity_type: options.entityType,
      entity_id: options.entityId,
    },
  });
}

/**
 * Send immediate email notification.
 * Returns success status.
 */
async function sendImmediateEmail(options: DispatchOptions): Promise<boolean> {
  // Import dynamically to avoid circular dependencies
  const { sendNotificationEmail } = await import('./email-notifications');

  try {
    const success = await sendNotificationEmail(
      options.userId,
      options.type,
      options.title,
      options.message,
      options.entityType,
      options.entityId
    );
    return success;
  } catch (error) {
    console.error('Failed to send immediate email notification:', error);
    return false;
  }
}

/**
 * Queue Slack notification for batching (project tasks).
 * Returns true if queued successfully.
 */
async function queueSlackNotification(options: DispatchOptions): Promise<boolean> {
  const { userId, type, title, message, entityId, metadata } = options;
  const projectId = metadata?.projectId as string;

  if (!projectId || !entityId) {
    console.error('Cannot queue Slack notification without projectId and entityId');
    return false;
  }

  const batchKey = `${userId}:${projectId}`;

  // Check if there's an existing pending batch for this user+project
  const existingBatch = await prisma.slackNotificationBatch.findFirst({
    where: {
      batch_key: batchKey,
      processed: false,
    },
    orderBy: { created_at: 'asc' },
  });

  // If existing batch, use its batch_ready_at; otherwise set 5 minutes from now
  const batchReadyAt = existingBatch?.batch_ready_at || new Date(Date.now() + 5 * 60 * 1000);

  await prisma.slackNotificationBatch.create({
    data: {
      user_id: userId,
      project_id: projectId,
      task_id: entityId,
      notification_type: type,
      title,
      message,
      batch_key: batchKey,
      batch_ready_at: batchReadyAt,
    },
  });

  return true;
}

/**
 * Send Slack notification immediately or queue for batching.
 * Returns success status.
 */
async function sendSlackNotification(options: DispatchOptions): Promise<boolean> {
  const { metadata } = options;

  // Check if this should be batched (project task that's not ad-hoc/support)
  const isAdHocOrSupport = metadata?.isAdHocOrSupport as boolean | undefined;
  const projectId = metadata?.projectId as string | undefined;

  // Batch project task notifications, send others immediately
  if (isAdHocOrSupport === false && projectId) {
    return queueSlackNotification(options);
  }

  // Import dynamically to avoid circular dependencies
  try {
    const { sendSlackNotification: sendSlack } = await import('./slack-notifications');
    const success = await sendSlack(options);
    return success;
  } catch (error) {
    // Slack module may not exist yet, or other error
    console.error('Failed to send Slack notification:', error);
    return false;
  }
}

/**
 * Update notification with delivery tracking.
 */
async function updateDeliveryTracking(
  notificationId: string,
  channel: 'email' | 'slack',
  sent: boolean
): Promise<void> {
  if (!sent) return;

  const updateData =
    channel === 'email'
      ? { email_sent: true, email_sent_at: new Date() }
      : { slack_sent: true, slack_sent_at: new Date() };

  await prisma.notification.update({
    where: { id: notificationId },
    data: updateData,
  });
}

/**
 * Main dispatcher function.
 * Routes notifications to appropriate channels based on user preferences and priority.
 */
export async function dispatchNotification(
  options: DispatchOptions
): Promise<DispatchResult> {
  const priority = options.priority || 'normal';

  // Determine which channels to use
  const channels = await determineChannels(options.userId, options.type, priority);

  const result: DispatchResult = {
    inApp: { sent: false },
    email: { sent: false },
    slack: { sent: false },
  };

  // In-app notification
  if (channels.inApp) {
    try {
      const notification = await createInAppNotification(options);
      if (notification) {
        result.inApp = { sent: true, notificationId: notification.id };
      }
    } catch (error) {
      console.error('Failed to create in-app notification:', error);
    }
  }

  // Email notification
  if (channels.email) {
    if (channels.emailImmediate) {
      // Send immediately for critical/high priority
      const sent = await sendImmediateEmail(options);
      result.email = { sent, queued: false };

      // Track delivery
      if (sent && result.inApp.notificationId) {
        await updateDeliveryTracking(result.inApp.notificationId, 'email', true);
      }
    } else {
      // Queue for daily digest
      try {
        await queueForEmailDigest(options);
        result.email = { sent: false, queued: true };
      } catch (error) {
        console.error('Failed to queue email for digest:', error);
        result.email = { sent: false, queued: false, error: 'Failed to queue' };
      }
    }
  }

  // Slack notification
  if (channels.slack) {
    const sent = await sendSlackNotification(options);
    result.slack = { sent };

    // Track delivery
    if (sent && result.inApp.notificationId) {
      await updateDeliveryTracking(result.inApp.notificationId, 'slack', true);
    }
  }

  return result;
}

/**
 * Helper to dispatch notification to multiple users.
 */
export async function dispatchNotificationToMany(
  userIds: string[],
  options: Omit<DispatchOptions, 'userId'>
): Promise<Map<string, DispatchResult>> {
  const results = new Map<string, DispatchResult>();

  for (const userId of userIds) {
    const result = await dispatchNotification({ ...options, userId });
    results.set(userId, result);
  }

  return results;
}

/**
 * Create notification without dispatching to external channels.
 * Useful for migrations or internal use.
 */
export async function createNotificationOnly(options: DispatchOptions): Promise<string | null> {
  const notification = await createInAppNotification(options);
  return notification?.id || null;
}
