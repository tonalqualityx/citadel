import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

/**
 * DELETE /api/admin/slack/mappings/[userId]
 * Remove a Slack user mapping
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { userId } = await params;

    // Check if mapping exists
    const mapping = await prisma.slackUserMapping.findUnique({
      where: { user_id: userId },
    });

    if (!mapping) {
      throw new ApiError('Mapping not found', 404);
    }

    // Delete the mapping
    await prisma.slackUserMapping.delete({
      where: { user_id: userId },
    });

    return NextResponse.json({
      success: true,
      message: 'Mapping removed',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
