/**
 * Slack Notifications Service
 *
 * Handles building and sending rich Slack notifications with full context.
 */

import { prisma } from '@/lib/db/prisma';
import { NotificationType } from '@prisma/client';
import {
  sendDirectMessage,
  getSlackUserIdForUser,
  trackSlackThread,
  getSlackConfig,
} from './slack';
import { DispatchOptions } from './notification-dispatcher';
import {
  escapeSlack,
  keptNoticeParts,
  buildKeptNoticeBlocks,
  buildDigestMessage,
  digestDue,
  type SlackSort,
} from './slack-sort';

// Priority labels and colors
const PRIORITY_CONFIG: Record<number, { label: string; emoji: string }> = {
  1: { label: 'Critical', emoji: '🔴' },
  2: { label: 'High', emoji: '🟠' },
  3: { label: 'Normal', emoji: '🟡' },
  4: { label: 'Low', emoji: '🟢' },
  5: { label: 'Minimal', emoji: '⚪' },
};

// Notification type icons
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
  article_needs_review: '✍️',
  troubador_run_created: '📝',
  troubador_run_review_ready: '✍️',
  article_client_approved: '✅',
  article_client_changes_requested: '🔁',
  interview_answers_submitted: '📨',
  oracle_urgent_email: '🚨',
  portal_emergency: '🚨',
  portal_chat_handoff: '💬',
  design_published: '🎨',
  design_publish_requested: '🙋',
  design_rolled_back: '⏪',
};

interface TaskContext {
  id: string;
  title: string;
  priority: number;
  clientName?: string;
  projectName?: string;
  siteName?: string;
  dueDate?: string;
}


/**
 * Get full task context for rich Slack messages
 */
async function getTaskContext(taskId: string): Promise<TaskContext | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      priority: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
      site: { select: { name: true } },
      due_date: true,
    },
  });

  if (!task) return null;

  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    clientName: task.client?.name,
    projectName: task.project?.name,
    siteName: task.site?.name,
    dueDate: task.due_date
      ? task.due_date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      : undefined,
  };
}

/**
 * Get the app URL for building links
 */
function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Build context line for Slack message
 * Example: "Client: Acme Corp | Project: Website Redesign | Priority: High 🟠"
 */
function buildContextLine(context: TaskContext): string {
  const parts: string[] = [];

  if (context.clientName) {
    parts.push(`*Client:* ${context.clientName}`);
  }
  if (context.projectName) {
    parts.push(`*Project:* ${context.projectName}`);
  }
  if (context.siteName) {
    parts.push(`*Site:* ${context.siteName}`);
  }

  const priorityInfo = PRIORITY_CONFIG[context.priority] || PRIORITY_CONFIG[3];
  parts.push(`*Priority:* ${priorityInfo.label} ${priorityInfo.emoji}`);

  return parts.join(' | ');
}

export { escapeSlack };

/**
 * Build Slack blocks for a notification
 */
export function buildSlackBlocks(
  type: NotificationType,
  title: string,
  message: string | undefined,
  context: TaskContext | null,
  entityUrl: string | null
): object[] {
  const icon = TYPE_ICONS[type];
  const blocks: object[] = [];
  // Slack mrkdwn treats & < > as control characters (<!channel>, <url|label>). Titles and
  // titles can carry client words (portal requests), so the title is escaped. Messages are
  // written by us and may use mrkdwn links on purpose.
  title = escapeSlack(title);

  // Header section
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${icon} *${title}*`,
    },
  });

  // Context line (client, project, site, priority)
  if (context) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: buildContextLine(context),
        },
      ],
    });
  }

  // Message body if present
  if (message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message,
      },
    });
  }

  // Action button
  if (entityUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Details →',
            emoji: true,
          },
          url: entityUrl,
          action_id: 'view_details',
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build entity URL for linking
 */
function buildEntityUrl(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;

  const baseUrl = getAppUrl();
  const entityRoutes: Record<string, string> = {
    task: '/tasks',
    project: '/projects',
    client: '/clients',
    site: '/sites',
    sop: '/sops',
    design_publish: '/design/publishes',
    design_session: '/design/s',
  };

  const route = entityRoutes[entityType];
  if (!route) return null;

  return `${baseUrl}${route}/${entityId}`;
}

/** KEEP: post one four-part Slack DM at once. Returns true if Slack accepted it. */
export async function sendSlackNotification(
  options: DispatchOptions
): Promise<boolean> {
  const { userId, type, title, message, entityType, entityId, metadata } = options;

  const config = await getSlackConfig();
  if (!config) {
    console.log('Slack not configured, skipping notification');
    return false;
  }

  const slackUserId = await getSlackUserIdForUser(userId);
  if (!slackUserId) {
    console.log('User has no Slack mapping, skipping notification');
    return false;
  }

  try {
    const entityUrl = buildEntityUrl(entityType, entityId);
    const taskContext = entityType === 'task' && entityId ? await getTaskContext(entityId) : null;

    const parts = keptNoticeParts({
      type,
      title,
      message,
      metadata,
      context: taskContext
        ? {
            title: taskContext.title,
            projectName: taskContext.projectName,
            clientName: taskContext.clientName,
            dueDate: taskContext.dueDate,
          }
        : null,
      link: entityUrl,
      appUrl: getAppUrl(),
    });
    const { text, blocks } = buildKeptNoticeBlocks(parts);

    const result = await sendDirectMessage(slackUserId, text, blocks);

    if (result.ok && result.ts && result.channel && entityId) {
      // Track the thread for reply syncing
      await trackSlackThread(
        entityType || 'notification',
        entityId,
        slackUserId,
        result.channel,
        result.ts
      );
    }

    if (result.ok) {
      try {
        await prisma.slackNotice.create({
          data: {
            ...noticeData(options, 'keep', parts.link),
            posted_text: result.text ?? text,
            slack_channel: result.channel,
            slack_ts: result.ts,
            sent_at: new Date(),
          },
        });
      } catch (error) {
        console.error('Failed to log kept Slack notice:', error);
      }
    }

    return result.ok;
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
    return false;
  }
}

function noticeData(options: DispatchOptions, sort: SlackSort, link: string | null) {
  const metaLink = options.metadata?.link;
  return {
    user_id: options.userId,
    sort,
    notification_type: options.type,
    title: options.title.slice(0, 255),
    message: options.message ?? null,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
    link: link ?? (typeof metaLink === 'string' ? metaLink : null),
  };
}

/** DIGEST: no post now; one line in the user's daily Slack DM. */
export async function queueSlackDigest(options: DispatchOptions): Promise<boolean> {
  const metaLink = options.metadata?.link;
  const link = typeof metaLink === 'string' ? metaLink : buildEntityUrl(options.entityType, options.entityId);
  await prisma.slackNotice.create({ data: noticeData(options, 'digest', link) });
  return true;
}

/** STOP: no Slack at all; the decision is logged only. */
export async function recordStoppedSlackNotice(options: DispatchOptions): Promise<boolean> {
  await prisma.slackNotice.create({
    data: noticeData(options, 'stop', buildEntityUrl(options.entityType, options.entityId)),
  });
  return true;
}

const NOTICE_KEEP_DAYS = 30;

/**
 * Send each user's daily digest when it is due (9:00 America/New_York, only on a day with lines),
 * then drop old log rows. Safe to call every 15 minutes.
 */
export async function sendDueSlackDigests(
  now: Date = new Date()
): Promise<{ users: number; sent: number; items: number; skipped: number; cleaned: number }> {
  const out = { users: 0, sent: 0, items: 0, skipped: 0, cleaned: 0 };

  const pending = await prisma.slackNotice.findMany({
    where: { sort: 'digest', sent_at: null },
    orderBy: { created_at: 'asc' },
  });
  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row);
    else byUser.set(row.user_id, [row]);
  }
  out.users = byUser.size;

  for (const [userId, rows] of byUser) {
    const last = await prisma.slackNotice.findFirst({
      where: { user_id: userId, sort: 'digest', sent_at: { not: null } },
      orderBy: { sent_at: 'desc' },
      select: { sent_at: true },
    });
    if (!digestDue(now, last?.sent_at ?? null)) continue;

    const ids = rows.map((r) => r.id);
    const slackUserId = await getSlackUserIdForUser(userId);
    if (!slackUserId) {
      await prisma.slackNotice.updateMany({ where: { id: { in: ids } }, data: { sent_at: now } });
      out.skipped += 1;
      continue;
    }

    const { text, blocks } = buildDigestMessage(rows, { appUrl: getAppUrl() });
    const result = await sendDirectMessage(slackUserId, text, blocks);
    if (!result.ok) continue;

    await prisma.slackNotice.updateMany({
      where: { id: { in: ids } },
      data: {
        sent_at: now,
        slack_ts: result.ts ?? null,
        slack_channel: result.channel ?? null,
        posted_text: result.text ?? text,
      },
    });
    out.sent += 1;
    out.items += rows.length;
  }

  const cutoff = new Date(now.getTime() - NOTICE_KEEP_DAYS * 24 * 60 * 60 * 1000);
  const cleaned = await prisma.slackNotice.deleteMany({
    where: { created_at: { lt: cutoff }, OR: [{ sort: 'stop' }, { sent_at: { not: null } }] },
  });
  out.cleaned = cleaned.count;
  return out;
}

/**
 * Build Slack blocks for a batched project task notification
 */
function buildBatchedTaskBlocks(
  projectName: string,
  projectId: string,
  tasks: Array<{ id: string; title: string }>,
): object[] {
  const blocks: object[] = [];

  // Header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `📋 *${tasks.length} new task${tasks.length > 1 ? 's' : ''} assigned* in project: ${projectName}`,
    },
  });

  // Divider
  blocks.push({ type: 'divider' });

  // Task list (up to 10 tasks shown)
  const displayTasks = tasks.slice(0, 10);
  const taskListText = displayTasks
    .map((task) => `• <${getAppUrl()}/tasks/${task.id}|${task.title}>`)
    .join('\n');

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: taskListText,
    },
  });

  // Show "and X more" if truncated
  if (tasks.length > 10) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_...and ${tasks.length - 10} more task${tasks.length - 10 > 1 ? 's' : ''}_`,
        },
      ],
    });
  }

  // Action button to view project
  const projectUrl = `${getAppUrl()}/projects/${projectId}`;
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Project →',
          emoji: true,
        },
        url: projectUrl,
        action_id: 'view_project',
      },
    ],
  });

  return blocks;
}

interface BatchGroup {
  userId: string;
  projectId: string;
  projectName: string;
  tasks: Array<{ id: string; title: string }>;
  batchIds: string[];
}

/**
 * Process pending Slack notification batches.
 * Finds all batches ready to send, groups by user+project, sends combined messages.
 * Returns number of batches processed.
 */
export async function processSlackNotificationBatches(): Promise<number> {
  // Find all pending batches that are ready
  const pendingBatches = await prisma.slackNotificationBatch.findMany({
    where: {
      processed: false,
      batch_ready_at: {
        lte: new Date(),
      },
    },
    orderBy: { created_at: 'asc' },
  });

  if (pendingBatches.length === 0) {
    return 0;
  }

  // Group by batch_key (user_id:project_id)
  const batchGroups = new Map<string, BatchGroup>();

  for (const batch of pendingBatches) {
    const existing = batchGroups.get(batch.batch_key);
    if (existing) {
      existing.tasks.push({ id: batch.task_id, title: batch.title.replace('New quest assigned: ', '') });
      existing.batchIds.push(batch.id);
    } else {
      // Fetch project name
      const project = await prisma.project.findUnique({
        where: { id: batch.project_id },
        select: { name: true },
      });

      batchGroups.set(batch.batch_key, {
        userId: batch.user_id,
        projectId: batch.project_id,
        projectName: project?.name || 'Unknown Project',
        tasks: [{ id: batch.task_id, title: batch.title.replace('New quest assigned: ', '') }],
        batchIds: [batch.id],
      });
    }
  }

  let processedCount = 0;

  // Send batched notifications
  for (const [, group] of batchGroups) {
    const slackUserId = await getSlackUserIdForUser(group.userId);
    if (!slackUserId) {
      // Mark as processed even if user has no Slack mapping
      await prisma.slackNotificationBatch.updateMany({
        where: { id: { in: group.batchIds } },
        data: { processed: true, processed_at: new Date() },
      });
      processedCount += group.batchIds.length;
      continue;
    }

    const blocks = buildBatchedTaskBlocks(group.projectName, group.projectId, group.tasks);
    const fallbackText = `📋 ${group.tasks.length} new task${group.tasks.length > 1 ? 's' : ''} assigned in ${group.projectName}`;

    const result = await sendDirectMessage(slackUserId, fallbackText, blocks);

    // Mark as processed
    await prisma.slackNotificationBatch.updateMany({
      where: { id: { in: group.batchIds } },
      data: { processed: true, processed_at: new Date() },
    });

    if (result.ok) {
      processedCount += group.batchIds.length;
    }
  }

  return processedCount;
}
