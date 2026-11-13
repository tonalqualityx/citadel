import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { getZonedDateString } from '@/lib/utils/time';
import { requireHomeUser } from '@/lib/home/gate';
import { loadHomeInputs } from '@/lib/home/load';
import { getHomeDay, getOrCreateHomeDay, loadItemStates, updateHomeDay } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { loadTriage } from '@/lib/tasks/triage';
import { loadOverdueByOthers } from '@/lib/home/overdue-others';
import { applyEmergencyInsert, assembleHomeResponse, proposeDay } from '@/lib/home/today';
import type { DayLike } from '@/lib/home/today';

/**
 * GET /api/home: the home screen, for the signed-in caller only (no user id parameter).
 *
 * Reads are free of side effects on shared records. The only write is the caller's own
 * home_day row: the first load of his local day stores the proposal; later loads reuse it,
 * and a new emergency is put at the top of Quick (steps untouched). Nothing with a score,
 * a class or candidate data leaves this file: assembleHomeResponse builds the payload.
 */
export async function GET() {
  try {
    const auth = await requireHomeUser();
    const userId = auth.userId;
    const now = new Date();
    const timezone = await resolveUserTimezone(userId);
    const date = getZonedDateString(now, timezone);

    const [raw, states] = await Promise.all([
      loadHomeInputs(prisma, userId, now, { timezone }),
      loadItemStates(prisma, userId),
    ]);
    const sel = selectHome({ raw, states, now });

    let day: DayLike | null = null;
    const proposal = proposeDay(sel, raw.calendar_events, now);
    if (proposal) {
      const { day: stored, created } = await getOrCreateHomeDay(prisma, userId, date, () => ({
        group_key: proposal.group_key,
        group_label: proposal.group_label,
        arc_id: proposal.arc_id,
        quick_item_keys: proposal.quick_item_keys,
        step_item_keys: proposal.step_item_keys,
        sized_minutes: proposal.sized_minutes,
      }));
      day = stored;
      if (!created) {
        const quick = applyEmergencyInsert(
          stored.quick_item_keys,
          stored.step_item_keys,
          sel.candidates,
          stored.group_key,
          now,
        );
        const changed =
          quick.length !== stored.quick_item_keys.length || quick.some((k, i) => k !== stored.quick_item_keys[i]);
        if (changed) {
          await updateHomeDay(prisma, userId, date, { quick_item_keys: quick });
          day = { ...stored, quick_item_keys: quick };
        }
      }
    } else {
      // Nothing proposed now: a day stored earlier still renders (no new record is written).
      day = await getHomeDay(prisma, userId, date);
    }

    const body = assembleHomeResponse({
      sel,
      day,
      calendar: raw.calendar_events,
      now,
      timezone,
      user_id: userId,
    });
    // Triage is Mike's alone: loadTriage answers null for anyone else, and a null section is left out of the payload.
    const triage = await loadTriage(prisma, userId);
    if (triage) body.triage = triage;
    // Overdue by others is his alone too: null for anyone else, and a null section is left out. Read only; no notification is made for it.
    const overdue = await loadOverdueByOthers(prisma, userId, now, timezone);
    if (overdue) body.past_date_others = overdue;
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
