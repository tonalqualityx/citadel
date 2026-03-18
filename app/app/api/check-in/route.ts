import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { buildTeamMemberCheckIn } from '@/lib/api/check-in/team-member';
import { buildPmCheckIn } from '@/lib/api/check-in/pm';

const VALID_VARIANTS = ['team_member', 'pm'] as const;
type Variant = typeof VALID_VARIANTS[number];

/**
 * GET /api/check-in?user_id={uuid}&variant={team_member|pm}
 *
 * Returns pre-computed check-in data for daily briefings.
 * Moves all task classification, blocker resolution, and badge computation server-side
 * to eliminate LLM interpretation bugs.
 *
 * - user_id: required — whose check-in data to generate
 * - variant: required — 'team_member' (simple daily briefing) or 'pm' (full operational dashboard)
 *
 * Auth:
 * - PM/Admin can query any user
 * - Tech users can only query themselves
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const userId = searchParams.get('user_id');
    const variant = searchParams.get('variant') as Variant | null;

    // Validate required params
    if (!userId) {
      throw new ApiError('user_id is required', 400);
    }
    if (!variant || !VALID_VARIANTS.includes(variant)) {
      throw new ApiError(`variant is required and must be one of: ${VALID_VARIANTS.join(', ')}`, 400);
    }

    // Auth check: tech users can only query themselves
    if (auth.role === 'tech' && userId !== auth.userId) {
      return NextResponse.json(
        { error: 'Tech users can only view their own check-in data' },
        { status: 403 }
      );
    }

    // Look up the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Build the appropriate variant
    const result = variant === 'team_member'
      ? await buildTeamMemberCheckIn(user)
      : await buildPmCheckIn(user);

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
