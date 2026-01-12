/**
 * Email Notification Service
 *
 * Handles sending notification emails - both immediate alerts and daily digests.
 */

import { prisma } from '@/lib/db/prisma';
import { NotificationType } from '@prisma/client';
import { sendEmail } from './email';

// Notification type labels for display
const TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: 'Task Assigned',
  task_status_changed: 'Task Status Changed',
  task_mentioned: 'You Were Mentioned',
  task_due_soon: 'Task Due Soon',
  task_overdue: 'Task Overdue',
  project_status_changed: 'Project Status Changed',
  review_requested: 'Review Requested',
  comment_added: 'New Comment',
  retainer_alert: 'Retainer Alert',
  system_alert: 'System Alert',
};

// Notification type icons/emojis for email
const TYPE_ICONS: Record<NotificationType, string> = {
  task_assigned: '📋',
  task_status_changed: '🔄',
  task_mentioned: '📢',
  task_due_soon: '⏰',
  task_overdue: '🚨',
  project_status_changed: '📊',
  review_requested: '👀',
  comment_added: '💬',
  retainer_alert: '📉',
  system_alert: '⚠️',
};

/**
 * Get the app URL for building links
 */
function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Build entity link URL
 */
function buildEntityUrl(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;

  const baseUrl = getAppUrl();
  const entityRoutes: Record<string, string> = {
    task: '/quests',
    project: '/pacts',
    client: '/patrons',
    site: '/sites',
    sop: '/scrolls',
  };

  const route = entityRoutes[entityType];
  if (!route) return null;

  return `${baseUrl}${route}/${entityId}`;
}

/**
 * Build immediate alert email content
 */
function buildImmediateAlertEmail(
  userName: string,
  type: NotificationType,
  title: string,
  message?: string,
  entityType?: string,
  entityId?: string
): { subject: string; text: string; html: string } {
  const typeLabel = TYPE_LABELS[type];
  const icon = TYPE_ICONS[type];
  const entityUrl = buildEntityUrl(entityType, entityId);
  const preferencesUrl = `${getAppUrl()}/settings/notifications`;

  const subject = `${icon} ${typeLabel}: ${title}`;

  const text = `
${typeLabel}

${title}
${message ? `\n${message}` : ''}
${entityUrl ? `\nView: ${entityUrl}` : ''}

---
Manage notification preferences: ${preferencesUrl}
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2D2D2D; margin: 0; padding: 0; background: #f5f5f5; }
    .wrapper { padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #5B8FB9 0%, #4A7A9F 100%); color: white; padding: 24px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .header .icon { font-size: 24px; margin-right: 8px; }
    .content { padding: 24px; }
    .title { font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 0 0 12px 0; }
    .message { color: #666; margin: 0 0 20px 0; }
    .button { display: inline-block; background: #5B8FB9; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; }
    .footer { padding: 16px 24px; background: #f9f9f9; border-top: 1px solid #eee; text-align: center; }
    .footer a { color: #5B8FB9; text-decoration: none; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1><span class="icon">${icon}</span> ${typeLabel}</h1>
      </div>
      <div class="content">
        <p class="title">${escapeHtml(title)}</p>
        ${message ? `<p class="message">${escapeHtml(message)}</p>` : ''}
        ${entityUrl ? `<p><a href="${entityUrl}" class="button">View Details →</a></p>` : ''}
      </div>
      <div class="footer">
        <a href="${preferencesUrl}">Manage notification preferences</a>
      </div>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Send an immediate notification email
 */
export async function sendNotificationEmail(
  userId: string,
  type: NotificationType,
  title: string,
  message?: string,
  entityType?: string,
  entityId?: string
): Promise<boolean> {
  try {
    // Get user email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) {
      console.error('User not found for email notification:', userId);
      return false;
    }

    const emailContent = buildImmediateAlertEmail(
      user.name,
      type,
      title,
      message,
      entityType,
      entityId
    );

    await sendEmail({
      to: user.email,
      ...emailContent,
    });

    return true;
  } catch (error) {
    console.error('Failed to send notification email:', error);
    return false;
  }
}

interface DigestItem {
  id: string;
  notification_type: NotificationType;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: Date;
}

/**
 * Build daily digest email content
 */
function buildDigestEmail(
  userName: string,
  date: Date,
  items: DigestItem[]
): { subject: string; text: string; html: string } {
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Group items by type
  const grouped = items.reduce(
    (acc, item) => {
      const type = item.notification_type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(item);
      return acc;
    },
    {} as Record<NotificationType, DigestItem[]>
  );

  const preferencesUrl = `${getAppUrl()}/settings/notifications`;

  const subject = `📬 Your Daily Summary - ${items.length} notification${items.length !== 1 ? 's' : ''}`;

  // Build text version
  const textSections = Object.entries(grouped)
    .map(([type, typeItems]) => {
      const typeLabel = TYPE_LABELS[type as NotificationType];
      const icon = TYPE_ICONS[type as NotificationType];
      return `${icon} ${typeLabel} (${typeItems.length})\n${typeItems.map((item) => `  • ${item.title}`).join('\n')}`;
    })
    .join('\n\n');

  const text = `
Your Daily Summary for ${dateStr}

Hi ${userName},

Here's what happened since your last digest:

${textSections}

---
View all notifications: ${getAppUrl()}/notifications
Manage preferences: ${preferencesUrl}
`.trim();

  // Build HTML version
  const htmlSections = Object.entries(grouped)
    .map(([type, typeItems]) => {
      const typeLabel = TYPE_LABELS[type as NotificationType];
      const icon = TYPE_ICONS[type as NotificationType];
      const itemsHtml = typeItems
        .map((item) => {
          const url = buildEntityUrl(item.entity_type || undefined, item.entity_id || undefined);
          return `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                ${url ? `<a href="${url}" style="color: #1a1a1a; text-decoration: none;">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}
                ${item.message ? `<br><span style="color: #666; font-size: 13px;">${escapeHtml(item.message)}</span>` : ''}
              </td>
            </tr>
          `;
        })
        .join('');

      return `
        <div style="margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #1a1a1a;">
            <span style="margin-right: 8px;">${icon}</span>${typeLabel}
            <span style="background: #e8f0f6; color: #5B8FB9; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 8px;">${typeItems.length}</span>
          </h3>
          <table style="width: 100%;" cellpadding="0" cellspacing="0">
            ${itemsHtml}
          </table>
        </div>
      `;
    })
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2D2D2D; margin: 0; padding: 0; background: #f5f5f5; }
    .wrapper { padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #5B8FB9 0%, #4A7A9F 100%); color: white; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header .date { opacity: 0.9; font-size: 14px; margin-top: 4px; }
    .content { padding: 24px; }
    .intro { color: #666; margin: 0 0 24px 0; }
    .footer { padding: 16px 24px; background: #f9f9f9; border-top: 1px solid #eee; text-align: center; }
    .footer a { color: #5B8FB9; text-decoration: none; font-size: 13px; margin: 0 8px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>📬 Your Daily Summary</h1>
        <div class="date">${dateStr}</div>
      </div>
      <div class="content">
        <p class="intro">Hi ${escapeHtml(userName)}, here's what happened since your last digest:</p>
        ${htmlSections}
      </div>
      <div class="footer">
        <a href="${getAppUrl()}/notifications">View all notifications</a>
        <span style="color: #ccc;">|</span>
        <a href="${preferencesUrl}">Manage preferences</a>
      </div>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

/**
 * Send a digest email to a user
 */
export async function sendDigestEmail(
  userId: string,
  items: DigestItem[]
): Promise<boolean> {
  if (items.length === 0) return true;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) {
      console.error('User not found for digest email:', userId);
      return false;
    }

    const emailContent = buildDigestEmail(user.name, new Date(), items);

    await sendEmail({
      to: user.email,
      ...emailContent,
    });

    return true;
  } catch (error) {
    console.error('Failed to send digest email:', error);
    return false;
  }
}

/**
 * Process the email digest queue and send digests.
 * Called by cron job at 8 AM.
 */
export async function processDigestQueue(): Promise<{
  usersProcessed: number;
  emailsSent: number;
  errors: number;
}> {
  const stats = { usersProcessed: 0, emailsSent: 0, errors: 0 };

  try {
    // Get all unprocessed digest items grouped by user
    const pendingItems = await prisma.emailDigestQueue.findMany({
      where: { processed: false },
      orderBy: { created_at: 'desc' },
    });

    if (pendingItems.length === 0) {
      console.log('No digest items to process');
      return stats;
    }

    // Group by user
    const byUser = pendingItems.reduce(
      (acc, item) => {
        if (!acc[item.user_id]) acc[item.user_id] = [];
        acc[item.user_id].push(item);
        return acc;
      },
      {} as Record<string, typeof pendingItems>
    );

    // Process each user
    for (const [userId, userItems] of Object.entries(byUser)) {
      stats.usersProcessed++;

      const digestItems: DigestItem[] = userItems.map((item) => ({
        id: item.id,
        notification_type: item.notification_type,
        title: item.title,
        message: item.message,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        created_at: item.created_at,
      }));

      const success = await sendDigestEmail(userId, digestItems);

      if (success) {
        stats.emailsSent++;

        // Mark items as processed
        await prisma.emailDigestQueue.updateMany({
          where: {
            id: { in: userItems.map((i) => i.id) },
          },
          data: {
            processed: true,
            processed_at: new Date(),
          },
        });
      } else {
        stats.errors++;
      }
    }

    console.log(
      `Digest processing complete: ${stats.usersProcessed} users, ${stats.emailsSent} emails sent, ${stats.errors} errors`
    );
    return stats;
  } catch (error) {
    console.error('Failed to process digest queue:', error);
    stats.errors++;
    return stats;
  }
}

/**
 * Clean up old processed digest items (older than 30 days)
 */
export async function cleanupDigestQueue(): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await prisma.emailDigestQueue.deleteMany({
    where: {
      processed: true,
      processed_at: { lt: thirtyDaysAgo },
    },
  });

  return result.count;
}
