import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  adminGetUserPreferences,
  adminOverridePreference,
  adminRemoveOverride,
  batchUpdatePreferences,
  NotificationChannel,
} from '@/lib/services/notification-preferences';
import { NotificationType } from '@prisma/client';

const overridePreferenceSchema = z.object({
  notification_type: z.nativeEnum(NotificationType),
  channel: z.enum(['in_app', 'email', 'slack']),
  enabled: z.boolean(),
  remove_override: z.boolean().optional(),
});

const batchOverrideSchema = z.object({
  overrides: z.array(overridePreferenceSchema),
});

/**
 * GET /api/admin/users/[id]/notification-preferences
 * Admin: Get a user's notification preference matrix
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id: userId } = await params;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    const matrix = await adminGetUserPreferences(userId);

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      ...matrix,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/admin/users/[id]/notification-preferences
 * Admin: Override user notification preferences
 * Body: { overrides: [{ notification_type, channel, enabled, remove_override? }] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id: userId } = await params;
    const body = await request.json();

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    const validated = batchOverrideSchema.parse(body);

    for (const override of validated.overrides) {
      if (override.remove_override) {
        // Remove the admin override
        await adminRemoveOverride(userId, override.notification_type);
      } else {
        // Set the override
        await adminOverridePreference(
          auth.userId,
          userId,
          override.notification_type,
          override.channel as NotificationChannel,
          override.enabled
        );
      }
    }

    // Return updated matrix
    const matrix = await adminGetUserPreferences(userId);
    return NextResponse.json(matrix);
  } catch (error) {
    return handleApiError(error);
  }
}
