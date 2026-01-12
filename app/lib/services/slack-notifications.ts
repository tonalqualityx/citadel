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
};

interface TaskContext {
  id: string;
  title: string;
  priority: number;
  clientName?: string;
  projectName?: string;
  siteName?: string;
}

interface CommentContext extends TaskContext {
  commenterName: string;
  commentSnippet: string;
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

/**
 * Build Slack blocks for a notification
 */
function buildSlackBlocks(
  type: NotificationType,
  title: string,
  message: string | undefined,
  context: TaskContext | null,
  entityUrl: string | null
): object[] {
  const icon = TYPE_ICONS[type];
  const blocks: object[] = [];

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
 * Build Slack blocks for a comment notification with rich context
 */
function buildCommentBlocks(
  taskContext: TaskContext,
  commenterName: string,
  commentSnippet: string,
  entityUrl: string | null
): object[] {
  const blocks: object[] = [];

  // Header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `💬 *New comment on:* ${taskContext.title}`,
    },
  });

  // Context line with client, project, site, priority
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(taskContext),
      },
    ],
  });

  // Divider
  blocks.push({ type: 'divider' });

  // Comment content
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${commenterName}* commented:\n> ${commentSnippet}`,
    },
  });

  // Action button
  if (entityUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Task →',
            emoji: true,
          },
          url: entityUrl,
          action_id: 'view_task',
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
 * Send a Slack notification to a user
 * Returns true if sent successfully
 */
export async function sendSlackNotification(
  options: DispatchOptions
): Promise<boolean> {
  const { userId, type, title, message, entityType, entityId, metadata } = options;

  // Check if Slack is configured
  const config = await getSlackConfig();
  if (!config) {
    console.log('Slack not configured, skipping notification');
    return false;
  }

  // Get user's Slack ID
  const slackUserId = await getSlackUserIdForUser(userId);
  if (!slackUserId) {
    console.log('User has no Slack mapping, skipping notification');
    return false;
  }

  try {
    let blocks: object[];
    let fallbackText: string;
    const entityUrl = buildEntityUrl(entityType, entityId);

    // Special handling for comment notifications with rich context
    if (type === 'comment_added' && entityType === 'task' && entityId) {
      const taskContext = await getTaskContext(entityId);
      if (taskContext) {
        const commenterName = (metadata?.commenterName as string) || 'Someone';
        const commentSnippet = (metadata?.commentSnippet as string) || message || '';

        blocks = buildCommentBlocks(
          taskContext,
          commenterName,
          commentSnippet.slice(0, 200) + (commentSnippet.length > 200 ? '...' : ''),
          entityUrl
        );
        fallbackText = `💬 New comment on: ${taskContext.title} - ${commenterName}: ${commentSnippet.slice(0, 100)}`;
      } else {
        // Fallback if task not found
        blocks = buildSlackBlocks(type, title, message, null, entityUrl);
        fallbackText = `${TYPE_ICONS[type]} ${title}`;
      }
    }
    // Task-related notifications with context
    else if (entityType === 'task' && entityId) {
      const taskContext = await getTaskContext(entityId);
      blocks = buildSlackBlocks(type, title, message, taskContext, entityUrl);
      fallbackText = `${TYPE_ICONS[type]} ${title}`;
    }
    // Generic notifications
    else {
      blocks = buildSlackBlocks(type, title, message, null, entityUrl);
      fallbackText = `${TYPE_ICONS[type]} ${title}`;
    }

    // Send the message
    const result = await sendDirectMessage(slackUserId, fallbackText, blocks);

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

    return result.ok;
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
    return false;
  }
}

/**
 * Send a comment notification via Slack with full context
 * This is a specialized function called directly when a comment is added
 */
export async function notifyCommentViaSlack(
  taskId: string,
  recipientUserId: string,
  commenterName: string,
  commentContent: string
): Promise<boolean> {
  const taskContext = await getTaskContext(taskId);
  if (!taskContext) return false;

  const slackUserId = await getSlackUserIdForUser(recipientUserId);
  if (!slackUserId) return false;

  const entityUrl = buildEntityUrl('task', taskId);
  const commentSnippet =
    commentContent.slice(0, 200) + (commentContent.length > 200 ? '...' : '');

  const blocks = buildCommentBlocks(taskContext, commenterName, commentSnippet, entityUrl);
  const fallbackText = `💬 New comment on: ${taskContext.title}`;

  const result = await sendDirectMessage(slackUserId, fallbackText, blocks);

  if (result.ok && result.ts && result.channel) {
    // Track thread for reply syncing
    await trackSlackThread('task', taskId, slackUserId, result.channel, result.ts);
  }

  return result.ok;
}

/**
 * Send a task assignment notification via Slack
 */
export async function notifyTaskAssignedViaSlack(
  taskId: string,
  assigneeUserId: string,
  assignerName: string
): Promise<boolean> {
  const taskContext = await getTaskContext(taskId);
  if (!taskContext) return false;

  const slackUserId = await getSlackUserIdForUser(assigneeUserId);
  if (!slackUserId) return false;

  const entityUrl = buildEntityUrl('task', taskId);
  const title = `New task assigned: ${taskContext.title}`;
  const message = `Assigned by ${assignerName}`;

  const blocks = buildSlackBlocks('task_assigned', title, message, taskContext, entityUrl);
  const fallbackText = `📋 ${title}`;

  const result = await sendDirectMessage(slackUserId, fallbackText, blocks);
  return result.ok;
}

/**
 * Send a review request notification via Slack
 */
export async function notifyReviewRequestedViaSlack(
  taskId: string,
  reviewerUserId: string,
  requesterName: string
): Promise<boolean> {
  const taskContext = await getTaskContext(taskId);
  if (!taskContext) return false;

  const slackUserId = await getSlackUserIdForUser(reviewerUserId);
  if (!slackUserId) return false;

  const entityUrl = buildEntityUrl('task', taskId);
  const title = `Review requested: ${taskContext.title}`;
  const message = `From: ${requesterName}`;

  const blocks = buildSlackBlocks('review_requested', title, message, taskContext, entityUrl);
  const fallbackText = `👀 ${title}`;

  const result = await sendDirectMessage(slackUserId, fallbackText, blocks);
  return result.ok;
}
