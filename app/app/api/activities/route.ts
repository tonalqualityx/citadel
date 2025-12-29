import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// GET /api/activities - List activities with optional filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entity_type');
    const entityId = searchParams.get('entity_id');
    const userId = searchParams.get('user_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build where clause
    const where: Record<string, unknown> = {};

    if (entityType) {
      where.entity_type = entityType;
    }

    if (entityId) {
      where.entity_id = entityId;
    }

    // Tech users can only see activities for entities they have access to
    // For simplicity in MVP, allow all users to see activities
    // (Access control on entity level is sufficient)
    if (userId) {
      where.user_id = userId;
    }

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar_url: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.activityLog.count({ where }),
    ]);

    return NextResponse.json({
      activities: activities.map((activity) => ({
        id: activity.id,
        user_id: activity.user_id,
        user: activity.user
          ? {
              id: activity.user.id,
              name: activity.user.name,
              email: activity.user.email,
              avatar_url: activity.user.avatar_url,
            }
          : null,
        action: activity.action,
        entity_type: activity.entity_type,
        entity_id: activity.entity_id,
        entity_name: activity.entity_name,
        changes: activity.changes,
        created_at: activity.created_at,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
