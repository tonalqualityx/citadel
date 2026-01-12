import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { z } from 'zod';
import {
  getAllPreferencesForUser,
  batchUpdatePreferences,
  NotificationChannel,
} from '@/lib/services/notification-preferences';
import { NotificationType } from '@prisma/client';

const updatePreferenceSchema = z.object({
  notification_type: z.nativeEnum(NotificationType),
  channel: z.enum(['in_app', 'email', 'slack']),
  enabled: z.boolean(),
});

const batchUpdateSchema = z.object({
  updates: z.array(updatePreferenceSchema),
});

/**
 * GET /api/users/me/notification-preferences
 * Get the current user's notification preference matrix
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const matrix = await getAllPreferencesForUser(auth.userId);

    return NextResponse.json(matrix);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/users/me/notification-preferences
 * Update notification preferences (batch)
 * Body: { updates: [{ notification_type, channel, enabled }] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();

    const validated = batchUpdateSchema.parse(body);

    const result = await batchUpdatePreferences(
      auth.userId,
      validated.updates.map((u) => ({
        notification_type: u.notification_type,
        channel: u.channel as NotificationChannel,
        enabled: u.enabled,
      }))
    );

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Some preferences could not be updated',
          details: result.errors,
        },
        { status: 400 }
      );
    }

    // Return updated matrix
    const matrix = await getAllPreferencesForUser(auth.userId);
    return NextResponse.json(matrix);
  } catch (error) {
    return handleApiError(error);
  }
}
