import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { WebClient } from '@slack/web-api';

const testConfigSchema = z.object({
  botToken: z.string().min(1).optional(),
  signingSecret: z.string().optional(),
});

interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const { botToken: providedToken } = testConfigSchema.parse(body);

    // Use provided token, or fall back to saved one
    let botToken = providedToken;
    if (!botToken) {
      const integration = await prisma.integration.findUnique({
        where: { provider: 'slack' },
      });
      const config = integration?.config as SlackConfig | undefined;
      botToken = config?.botToken;
    }

    if (!botToken) {
      throw new ApiError('No bot token provided and none saved', 400);
    }

    // Test the connection
    const client = new WebClient(botToken);
    const result = await client.auth.test();

    if (!result.ok) {
      throw new ApiError(`Slack error: ${result.error}`, 400);
    }

    return NextResponse.json({
      success: true,
      teamName: result.team,
      teamId: result.team_id,
      botName: result.user,
      botId: result.user_id,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(error);
    }
    // Handle Slack API errors
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json(
      { error: message, success: false },
      { status: 400 }
    );
  }
}
