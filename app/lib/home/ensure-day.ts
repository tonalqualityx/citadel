import type { PrismaClient } from '@prisma/client';
import { zonedDateString } from './act';
import { loadHomeInputs } from './load';
import { getHomeDay, getOrCreateHomeDay, loadItemStates } from './state';
import { selectHome } from './select';
import { proposeDay } from './today';

/**
 * Make sure the user has a home_day row for today (his zone), storing the day's proposal when there is none yet.
 * This is the same first-load write `GET /api/home` does (read, select, propose, get-or-create), without building the
 * response, so a caller that acts on today's steps, swap or lighter work before the screen has loaded that day (the
 * Bast chat's home op, after midnight) finds the row. Returns the date stored or found, or null when nothing is in
 * view (then no row is written and the act is refused as a stale day, as on the screen).
 */
export async function ensureHomeDay(db: PrismaClient, userId: string, now: Date, timezone: string): Promise<string | null> {
  const date = zonedDateString(now, timezone);
  if (await getHomeDay(db, userId, date)) return date;
  const [raw, states] = await Promise.all([loadHomeInputs(db, userId, now, { timezone }), loadItemStates(db, userId)]);
  const sel = selectHome({ raw, states, now });
  const proposal = proposeDay(sel, raw.calendar_events, now);
  if (!proposal) return null;
  await getOrCreateHomeDay(db, userId, date, () => ({
    group_key: proposal.group_key,
    group_label: proposal.group_label,
    arc_id: proposal.arc_id,
    quick_item_keys: proposal.quick_item_keys,
    step_item_keys: proposal.step_item_keys,
    sized_minutes: proposal.sized_minutes,
  }));
  return date;
}
