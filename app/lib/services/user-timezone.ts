import { prisma } from '@/lib/db/prisma';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';

/**
 * Clarity Phase 3d — per-user timezone resolution, server-side, per request.
 *
 * Resolution chain (Mike's ruling: timezone is PER-USER, not a global constant —
 * other users are in other zones, e.g. Sabeen in Asia/Karachi):
 *   1. The requesting user's own UserPreference.timezone, if set.
 *   2. process.env.CITADEL_DISPLAY_TZ, if set.
 *   3. 'America/New_York' (DEFAULT_DISPLAY_TIMEZONE — Mike's zone, and this repo's
 *      practical default until more users are onboarded onto the Oracle).
 *
 * Centralized here so every "which calendar day does this belong to" / "what hour do
 * I render this at" computation across /api/today, /api/today/calendar, and the week
 * capacity strip resolves the SAME way for a given request — never a per-call guess.
 * No settings UI exists yet to let a user set their own timezone (Phase 4); until then
 * this only ever returns something other than the fallback if a row is seeded/set
 * directly (see scripts/seed-oracle-fixtures.ts for Mike's own row).
 */
export async function resolveUserTimezone(userId: string): Promise<string> {
  const pref = await prisma.userPreference.findUnique({
    where: { user_id: userId },
    select: { timezone: true },
  });
  return pref?.timezone || DEFAULT_DISPLAY_TIMEZONE;
}
