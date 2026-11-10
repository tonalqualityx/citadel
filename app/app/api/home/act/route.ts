/**
 * POST /api/home/act: one home-only action (plan task H7). Writes only the caller's own
 * home_item_state, home_day and home_actions rows. The body names no user; the caller is the
 * signed-in session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { requireHomeUser } from '@/lib/home/gate';
import { homeActSchema, runHomeAct, zonedDateString } from '@/lib/home/act';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = homeActSchema.parse(body);

    const now = new Date();
    const timezone = await resolveUserTimezone(auth.userId);
    const result = await runHomeAct(prisma, auth.userId, parsed, {
      now,
      timezone,
      date: zonedDateString(now, timezone),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
