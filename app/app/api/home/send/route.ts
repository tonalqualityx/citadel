/**
 * POST /api/home/send: Mike's press on "Send the draft" (Home Slice 4b). Browser session only: requireHomeUser refuses an API
 * key with 403, so the chat key, the courier key, the keeper and the drafter can never call it. It also needs his own
 * HomeKeeperSettings.owed_send switch (off by default; no settings row means off): 409 send_off otherwise.
 *
 * Body `{item_key, draft_id}`, strict. `draft_id` is Bast's current draft for the newest open mail on the thread, or the short
 * holding draft (the same door, the same checks).
 * 200 `{ok, action_id, send_after, item_key, message}`. Nothing is sent here: it writes the home_actions row of the press
 * and one held outbox row (kind owed_reply, send_after = now + 10 minutes). Undo is POST /api/home/undo until send_after.
 * 409 `send_off`, `not_current`, `already_queued`, `draft_blank`; 404 when the thread is not open.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '@/lib/home/gate';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { queueOwedReplySend, sendBodySchema } from '@/lib/home/owed/send';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = sendBodySchema.parse(body);
    const now = new Date();
    const timezone = await resolveUserTimezone(auth.userId);
    const result = await prisma.$transaction((tx) => queueOwedReplySend(tx, auth.userId, parsed, now, timezone));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
