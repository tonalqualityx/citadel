import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { getSlackConfig, lookupSlackUserByEmail } from '@/lib/services/slack';

const createMappingSchema = z.object({
  userId: z.string().uuid(),
  slackUserId: z.string().min(1),
  slackTeamId: z.string().optional(),
  displayName: z.string().optional(),
});

const autoMatchSchema = z.object({
  userIds: z.array(z.string().uuid()).optional(),
});

/**
 * GET /api/admin/slack/mappings
 * List all Slack user mappings with user details
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    // Get all users with their Slack mappings
    const users = await prisma.user.findMany({
      where: { is_active: true },
      select: {
        id: true,
        name: true,
        email: true,
        slack_mapping: {
          select: {
            slack_user_id: true,
            slack_team_id: true,
            display_name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      mappings: users.map((user) => ({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        slackUserId: user.slack_mapping?.slack_user_id || null,
        slackTeamId: user.slack_mapping?.slack_team_id || null,
        slackDisplayName: user.slack_mapping?.display_name || null,
        isLinked: !!user.slack_mapping,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/admin/slack/mappings
 * Create or update a Slack user mapping
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();

    // Handle auto-match request
    if (body.autoMatch) {
      const { userIds } = autoMatchSchema.parse(body);
      return handleAutoMatch(userIds);
    }

    const { userId, slackUserId, slackTeamId, displayName } = createMappingSchema.parse(body);

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Get Slack config for team ID
    const config = await getSlackConfig();
    const teamId = slackTeamId || config?.teamId || '';

    // Create or update mapping
    const mapping = await prisma.slackUserMapping.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        slack_user_id: slackUserId,
        slack_team_id: teamId,
        display_name: displayName,
      },
      update: {
        slack_user_id: slackUserId,
        slack_team_id: teamId,
        display_name: displayName,
      },
    });

    return NextResponse.json({
      success: true,
      mapping: {
        userId: mapping.user_id,
        slackUserId: mapping.slack_user_id,
        slackTeamId: mapping.slack_team_id,
        displayName: mapping.display_name,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Handle auto-matching users to Slack by email
 */
async function handleAutoMatch(userIds?: string[]) {
  // Get users to match
  const whereClause = userIds?.length
    ? { id: { in: userIds }, is_active: true }
    : { is_active: true };

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      email: true,
      name: true,
      slack_mapping: { select: { id: true } },
    },
  });

  // Only try to match users without existing mappings
  const unmappedUsers = users.filter((u) => !u.slack_mapping);

  const results: Array<{
    userId: string;
    userName: string;
    matched: boolean;
    slackUserId?: string;
    error?: string;
  }> = [];

  for (const user of unmappedUsers) {
    try {
      const slackUser = await lookupSlackUserByEmail(user.email);

      if (slackUser) {
        // Get Slack config for team ID
        const config = await getSlackConfig();

        await prisma.slackUserMapping.create({
          data: {
            user_id: user.id,
            slack_user_id: slackUser.id,
            slack_team_id: config?.teamId || '',
            display_name: slackUser.real_name || slackUser.name,
          },
        });

        results.push({
          userId: user.id,
          userName: user.name,
          matched: true,
          slackUserId: slackUser.id,
        });
      } else {
        results.push({
          userId: user.id,
          userName: user.name,
          matched: false,
          error: 'No Slack user found with matching email',
        });
      }
    } catch (error) {
      results.push({
        userId: user.id,
        userName: user.name,
        matched: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const matchedCount = results.filter((r) => r.matched).length;

  return NextResponse.json({
    success: true,
    matchedCount,
    totalAttempted: results.length,
    results,
  });
}
