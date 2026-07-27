import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { getZonedDateString } from '@/lib/utils/time';

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q14) — cron chips v1's snooze/dismiss
// persistence. Admin-only, same gate as the rest of the Oracle surface.

/** Start of the NEXT calendar day in the requester's resolved timezone, represented as
 *  a UTC-midnight Date for that date string — same "date string -> UTC midnight"
 *  convention /api/today's own parseDateParam already uses for calendar-day boundaries. */
function startOfTomorrow(timezone: string): Date {
  const todayStr = getZonedDateString(new Date(), timezone);
  const tomorrow = new Date(`${todayStr}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow;
}

const upsertSchema = z.object({
  cron_key: z.string().min(1).max(300),
  action: z.enum(['snooze', 'dismiss']),
  // The chip's CURRENT attention_reason at the moment of dismissal — required for
  // action=dismiss (that's the fingerprint a changed/new failure compares against to
  // "re-fire"); ignored for action=snooze.
  reason: z.string().max(2000).optional().nullable(),
});

export async function GET() {
  try {
    await requireAuth();
    const states = await prisma.cronChipState.findMany({
      select: { cron_key: true, snoozed_until: true, dismissed_reason: true },
    });
    return NextResponse.json({ states });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = upsertSchema.parse(body);

    if (data.action === 'dismiss' && !data.reason) {
      throw new ApiError('reason is required to dismiss a cron chip', 400);
    }

    const timezone = await resolveUserTimezone(auth.userId);
    const updateData =
      data.action === 'snooze'
        ? { snoozed_until: startOfTomorrow(timezone), dismissed_reason: null }
        : { dismissed_reason: data.reason ?? null, snoozed_until: null };

    const state = await prisma.cronChipState.upsert({
      where: { cron_key: data.cron_key },
      create: { cron_key: data.cron_key, ...updateData },
      update: updateData,
      select: { cron_key: true, snoozed_until: true, dismissed_reason: true },
    });

    return NextResponse.json(state);
  } catch (error) {
    return handleApiError(error);
  }
}
