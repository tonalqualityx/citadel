import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifySlackRequest, getSlackConfig, findEntityBySlackThread } from '@/lib/services/slack';

interface SlackUrlVerificationEvent {
  type: 'url_verification';
  challenge: string;
}

interface SlackEventCallback {
  type: 'event_callback';
  event: SlackEvent;
}

interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

type SlackPayload = SlackUrlVerificationEvent | SlackEventCallback;

/**
 * POST /api/webhooks/slack/events
 *
 * Handles incoming Slack events:
 * 1. URL verification challenge (for initial setup)
 * 2. Message events in DM threads (for reply sync)
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const body = JSON.parse(rawBody) as SlackPayload;

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      console.log('Slack URL verification challenge received');
      return NextResponse.json({ challenge: body.challenge });
    }

    // Verify the request signature for event callbacks
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');

    if (!signature || !timestamp) {
      console.warn('Missing Slack signature headers');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const config = await getSlackConfig();
    if (!config) {
      console.warn('Slack not configured, ignoring webhook');
      return NextResponse.json({ ok: true });
    }

    const isValid = verifySlackRequest(signature, timestamp, rawBody, config.signingSecret);
    if (!isValid) {
      console.warn('Invalid Slack signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Handle event callbacks
    if (body.type === 'event_callback') {
      const event = body.event;

      // Handle message in DM (for reply sync)
      if (event.type === 'message' && event.thread_ts && event.user && event.text) {
        await handleSlackReply(event);
      }
    }

    // Always respond quickly to Slack
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Slack webhook error:', error);
    // Return 200 to prevent Slack retries for errors we can't fix
    return NextResponse.json({ ok: true });
  }
}

/**
 * Handle a reply in a Slack thread by creating a comment in Citadel
 */
async function handleSlackReply(event: SlackEvent): Promise<void> {
  if (!event.channel || !event.thread_ts || !event.user || !event.text) {
    return;
  }

  try {
    // Find the entity associated with this thread
    const entity = await findEntityBySlackThread(event.channel, event.thread_ts);

    if (!entity) {
      console.log('No entity found for Slack thread:', event.thread_ts);
      return;
    }

    // Only handle task threads for now
    if (entity.entityType !== 'task') {
      console.log('Reply sync only supported for tasks, got:', entity.entityType);
      return;
    }

    // Find the Citadel user from Slack user ID
    const mapping = await prisma.slackUserMapping.findFirst({
      where: { slack_user_id: event.user },
      select: { user_id: true },
    });

    if (!mapping) {
      console.log('No Citadel user found for Slack user:', event.user);
      return;
    }

    // Verify the task exists
    const task = await prisma.task.findUnique({
      where: { id: entity.entityId },
      select: { id: true, is_deleted: true },
    });

    if (!task || task.is_deleted) {
      console.log('Task not found or deleted:', entity.entityId);
      return;
    }

    // Check for duplicate (idempotency) - use Slack ts as a unique identifier
    // We'll check if a comment with the same content was just created
    const recentComment = await prisma.comment.findFirst({
      where: {
        task_id: entity.entityId,
        user_id: mapping.user_id,
        content: event.text,
        created_at: {
          gte: new Date(Date.now() - 60 * 1000), // Last minute
        },
      },
    });

    if (recentComment) {
      console.log('Duplicate comment detected, skipping');
      return;
    }

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        task_id: entity.entityId,
        user_id: mapping.user_id,
        content: event.text,
      },
    });

    console.log('Created comment from Slack reply:', comment.id);

    // Optionally notify other task watchers
    // This would use the notification dispatcher, but we skip it here
    // to avoid notification loops (Slack reply -> comment -> Slack notification)
  } catch (error) {
    console.error('Error handling Slack reply:', error);
  }
}
