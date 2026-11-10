import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, AuthError } from '@/lib/api/errors';
import { z } from 'zod';

const updatePreferencesSchema = z.object({
  naming_convention: z.enum(['awesome', 'standard']).optional(),
  theme: z.enum(['light', 'dim', 'dark', 'system']).optional(),
  notification_bundle: z.boolean().optional(),
  // Clarity Phase 7 (P2) — the Today section's list/board lens, persisted cross-device.
  today_view: z.enum(['list', 'board']).optional(),
  // Clarity Phase 3 (Reckoning, spec Q9/G10) — Today's energy filter chip, persisted
  // cross-device same as today_view above.
  energy_filter: z.enum(['all', 'low_energy', 'deep_work']).optional(),
  // Home screen Slice 1: which first screen /dashboard renders. 'home' is admin-only.
  home_view: z.enum(['overlook', 'home']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const preferences = await prisma.userPreference.findUnique({
      where: { user_id: auth.userId },
      select: {
        naming_convention: true,
        theme: true,
        notification_bundle: true,
        today_view: true,
        energy_filter: true,
        home_view: true,
      },
    });

    // Return defaults if no preferences exist
    return NextResponse.json({
      preferences: preferences || {
        naming_convention: 'awesome',
        theme: 'system',
        notification_bundle: true,
        today_view: 'list',
        energy_filter: 'all',
        home_view: 'overlook',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();

    const validated = updatePreferencesSchema.parse(body);

    if (validated.home_view === 'home' && auth.role !== 'admin') {
      throw new AuthError('Only an admin can turn on the home screen', 403);
    }

    // Upsert preferences
    const preferences = await prisma.userPreference.upsert({
      where: { user_id: auth.userId },
      update: validated,
      create: {
        user_id: auth.userId,
        naming_convention: validated.naming_convention ?? 'awesome',
        theme: validated.theme ?? 'system',
        notification_bundle: validated.notification_bundle ?? true,
        today_view: validated.today_view ?? 'list',
        energy_filter: validated.energy_filter ?? 'all',
        home_view: validated.home_view ?? 'overlook',
      },
      select: {
        naming_convention: true,
        theme: true,
        notification_bundle: true,
        today_view: true,
        energy_filter: true,
        home_view: true,
      },
    });

    return NextResponse.json({ preferences });
  } catch (error) {
    return handleApiError(error);
  }
}
