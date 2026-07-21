/**
 * Clarity Phase 3d — display-timezone fallback constant. Client-safe: this file has
 * NO Prisma import, so 'use client' components can pull it in as a loading-state
 * fallback before the resolved-per-user `timezone` field on a /api/today* response has
 * arrived (see lib/services/user-timezone.ts for the actual per-user resolution,
 * which is server-only).
 *
 * Mike's ruling: timezone is PER-USER, not a single global constant — other users
 * (e.g. Sabeen, Asia/Karachi) are in other zones. This constant is only the last link
 * in the resolution chain (a user's own UserPreference.timezone always wins), so it's
 * deliberately just "the practical default for this repo today" rather than something
 * named DISPLAY_TIMEZONE that would wrongly suggest it's authoritative.
 *
 * `NEXT_PUBLIC_CITADEL_DISPLAY_TZ` is read so a client bundle can honor an override
 * too; `CITADEL_DISPLAY_TZ` (no NEXT_PUBLIC_ prefix) is what server-side code sets —
 * Next.js inlines only NEXT_PUBLIC_-prefixed vars into client bundles, so reading both
 * here means either surface can be overridden independently without one leaking into
 * the other's bundle.
 */
export const DEFAULT_DISPLAY_TIMEZONE =
  process.env.NEXT_PUBLIC_CITADEL_DISPLAY_TZ || process.env.CITADEL_DISPLAY_TZ || 'America/New_York';
