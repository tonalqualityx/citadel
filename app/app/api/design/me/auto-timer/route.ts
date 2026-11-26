import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation } from '@/lib/design/route-kit';
import { autoTrackingOn } from '@/lib/design/timer';

/**
 * GET/PATCH /api/design/me/auto-timer: the caller's own automatic time tracking setting, for the switch in the
 * designer portal header (Mike, 2026-11-26: "make auto time tracking a user setting and toggle it off for everyone
 * except me"). A designer may not call /api/users/me/preferences, so the portal gets this one field. Signed-in
 * session only; reads and writes only the caller's own preferences row. Off by default.
 */
export async function GET() {
  try {
    const { actor } = await authActor();
    return NextResponse.json({ auto_time_tracking: await autoTrackingOn(actor.userId, prisma) });
  } catch (error) {
    return handleApiError(error);
  }
}

const schema = z.object({ auto_time_tracking: z.boolean() }).strict();

export async function PATCH(request: NextRequest) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  try {
    const { actor } = await authActor();
    const { auto_time_tracking } = await body(request, schema);
    const row = await prisma.userPreference.upsert({
      where: { user_id: actor.userId },
      update: { auto_time_tracking },
      create: { user_id: actor.userId, auto_time_tracking },
      select: { auto_time_tracking: true },
    });
    return NextResponse.json({ auto_time_tracking: row.auto_time_tracking });
  } catch (error) {
    return handleApiError(error);
  }
}
