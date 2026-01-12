/**
 * Slack API Client Service
 *
 * Provides a wrapper around the Slack Web API for sending messages
 * and managing Slack integrations.
 */

import { WebClient } from '@slack/web-api';
import { prisma } from '@/lib/db/prisma';
import crypto from 'crypto';

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appId?: string;
  teamId?: string;
  teamName?: string;
  setupComplete?: boolean;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  email?: string;
}

export interface SlackMessageResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

// Cache the Slack client to avoid re-initializing
let cachedClient: WebClient | null = null;
let cachedConfig: SlackConfig | null = null;

/**
 * Get the Slack configuration from the database
 */
export async function getSlackConfig(): Promise<SlackConfig | null> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { provider: 'slack' },
    });

    if (!integration || !integration.is_active) {
      return null;
    }

    const config = integration.config as unknown as SlackConfig;
    if (!config.botToken || !config.signingSecret) {
      return null;
    }

    return config;
  } catch (error) {
    console.error('Failed to get Slack config:', error);
    return null;
  }
}

/**
 * Get an initialized Slack WebClient
 * Returns null if Slack is not configured
 */
export async function getSlackClient(): Promise<WebClient | null> {
  const config = await getSlackConfig();

  if (!config) {
    cachedClient = null;
    cachedConfig = null;
    return null;
  }

  // Return cached client if config hasn't changed
  if (cachedClient && cachedConfig?.botToken === config.botToken) {
    return cachedClient;
  }

  // Create new client
  cachedClient = new WebClient(config.botToken);
  cachedConfig = config;

  return cachedClient;
}

/**
 * Open a direct message channel with a user
 * Returns the channel ID for sending DMs
 */
export async function openDirectMessageChannel(
  slackUserId: string
): Promise<string | null> {
  const client = await getSlackClient();
  if (!client) return null;

  try {
    const result = await client.conversations.open({
      users: slackUserId,
    });

    if (result.ok && result.channel?.id) {
      return result.channel.id;
    }

    console.error('Failed to open DM channel:', result.error);
    return null;
  } catch (error) {
    console.error('Error opening DM channel:', error);
    return null;
  }
}

/**
 * Send a direct message to a Slack user
 */
export async function sendDirectMessage(
  slackUserId: string,
  text: string,
  blocks?: object[]
): Promise<SlackMessageResponse> {
  const client = await getSlackClient();
  if (!client) {
    return { ok: false, error: 'Slack not configured' };
  }

  try {
    // Open DM channel first
    const channel = await openDirectMessageChannel(slackUserId);
    if (!channel) {
      return { ok: false, error: 'Failed to open DM channel' };
    }

    // Send message
    const result = await client.chat.postMessage({
      channel,
      text,
      blocks: blocks as unknown as undefined,
    });

    if (result.ok) {
      return {
        ok: true,
        ts: result.ts,
        channel: result.channel,
      };
    }

    return { ok: false, error: result.error };
  } catch (error) {
    console.error('Error sending DM:', error);
    return { ok: false, error: String(error) };
  }
}

/**
 * Verify a Slack request signature
 * Used to authenticate incoming webhook requests
 */
export function verifySlackRequest(
  signature: string,
  timestamp: string,
  body: string,
  signingSecret: string
): boolean {
  // Check timestamp isn't too old (within 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);

  if (Math.abs(currentTime - requestTime) > 60 * 5) {
    console.warn('Slack request timestamp too old');
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  // Compare signatures (timing-safe)
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * List all users in the Slack workspace
 * Used for admin user mapping UI
 */
export async function listSlackUsers(): Promise<SlackUser[]> {
  const client = await getSlackClient();
  if (!client) return [];

  try {
    const result = await client.users.list({});

    if (!result.ok || !result.members) {
      console.error('Failed to list Slack users:', result.error);
      return [];
    }

    // Filter out bots and deactivated users
    return result.members
      .filter((member) => !member.is_bot && !member.deleted)
      .map((member) => ({
        id: member.id!,
        name: member.name || '',
        real_name: member.real_name,
        email: member.profile?.email,
      }));
  } catch (error) {
    console.error('Error listing Slack users:', error);
    return [];
  }
}

/**
 * Look up a Slack user by email
 */
export async function lookupSlackUserByEmail(
  email: string
): Promise<SlackUser | null> {
  const client = await getSlackClient();
  if (!client) return null;

  try {
    const result = await client.users.lookupByEmail({ email });

    if (result.ok && result.user) {
      return {
        id: result.user.id!,
        name: result.user.name || '',
        real_name: result.user.real_name,
        email: result.user.profile?.email,
      };
    }

    return null;
  } catch (error) {
    // users.lookupByEmail throws if user not found
    console.log('Slack user not found by email:', email);
    return null;
  }
}

/**
 * Test the Slack connection
 * Returns auth info if successful
 */
export async function testSlackConnection(): Promise<{
  ok: boolean;
  teamName?: string;
  botName?: string;
  error?: string;
}> {
  const client = await getSlackClient();
  if (!client) {
    return { ok: false, error: 'Slack not configured' };
  }

  try {
    const result = await client.auth.test();

    if (result.ok) {
      return {
        ok: true,
        teamName: result.team,
        botName: result.user,
      };
    }

    return { ok: false, error: result.error };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Get the user ID of a Citadel user's linked Slack account
 */
export async function getSlackUserIdForUser(userId: string): Promise<string | null> {
  const mapping = await prisma.slackUserMapping.findUnique({
    where: { user_id: userId },
    select: { slack_user_id: true },
  });

  return mapping?.slack_user_id || null;
}

/**
 * Check if a user has a Slack account linked
 */
export async function isSlackLinked(userId: string): Promise<boolean> {
  const mapping = await prisma.slackUserMapping.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });

  return !!mapping;
}

/**
 * Track a Slack message thread for reply syncing
 */
export async function trackSlackThread(
  entityType: string,
  entityId: string,
  slackUserId: string,
  channel: string,
  ts: string
): Promise<void> {
  await prisma.slackMessageThread.upsert({
    where: {
      entity_type_entity_id_slack_user_id: {
        entity_type: entityType,
        entity_id: entityId,
        slack_user_id: slackUserId,
      },
    },
    create: {
      entity_type: entityType,
      entity_id: entityId,
      slack_user_id: slackUserId,
      slack_channel: channel,
      slack_ts: ts,
    },
    update: {
      slack_channel: channel,
      slack_ts: ts,
    },
  });
}

/**
 * Find entity by Slack thread timestamp
 * Used when processing replies
 */
export async function findEntityBySlackThread(
  channel: string,
  threadTs: string
): Promise<{ entityType: string; entityId: string } | null> {
  const thread = await prisma.slackMessageThread.findFirst({
    where: {
      slack_channel: channel,
      slack_ts: threadTs,
    },
    select: {
      entity_type: true,
      entity_id: true,
    },
  });

  if (!thread) return null;

  return {
    entityType: thread.entity_type,
    entityId: thread.entity_id,
  };
}
