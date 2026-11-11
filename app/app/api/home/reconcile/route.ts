/**
 * POST /api/home/reconcile: his tap on a card from his sent mail that can create a time entry (Home Slice 9a). Browser session only:
 * requireHomeUser refuses an API key with 403, so the chat key, the courier key and the machine job can never call it. It is the ONLY
 * path that creates a time entry from these cards (homeActSchema refuses track_it and log_time).
 *
 * Body (strict), one of:
 *   `{action: "track_it", item_key: "proposal:<uuid>", placement: "project" | "new_project" | "none", minutes: int | null, billable: boolean}`
 *   `{action: "log_time", task_id, minutes, day: "YYYY-MM-DD"}`   (the "Log time?" prompt on a done task with no time)
 *   `{action: "proposal_yes", item_key, minutes: int | null}`    (a done card with a time choice)
 * 200 `{ok, action_id, undo_until, item_key, message}`. Undo is POST /api/home/undo for 24 hours (compare-and-set, soft delete).
 * 409 `card_gone`, `changed_since`, `bad_choice` (a placement the card did not offer), `has_time`; 404 `not_found`; 409 when the sent-mail
 * switch is off.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '@/lib/home/gate';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { homeReconcileBodySchema } from '@/lib/home/reconcile/schema';
import { reconcileOn } from '@/lib/home/reconcile/load';
import { logTime, proposalYes } from '@/lib/home/reconcile/apply';
import { trackIt } from '@/lib/home/reconcile/track';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = homeReconcileBodySchema.parse(body);
    if (!(await reconcileOn(prisma, auth.userId))) throw new ApiError('Cards from your sent mail are turned off.', 409, 'reconcile_off');
    const now = new Date();
    const timezone = await resolveUserTimezone(auth.userId);
    const o = { now, timezone };
    const result =
      parsed.action === 'track_it'
        ? await trackIt(prisma, auth.userId, parsed.item_key, { placement: parsed.placement, minutes: parsed.minutes, billable: parsed.billable }, o)
        : parsed.action === 'log_time'
          ? await logTime(prisma, auth.userId, { task_id: parsed.task_id, minutes: parsed.minutes, day: parsed.day }, o)
          : await proposalYes(prisma, auth.userId, parsed.item_key, { ...o, allowTime: true, minutes: parsed.minutes });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
