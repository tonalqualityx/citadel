/**
 * Clarity Phase 7 (Seeing Stone Reckoning — repair, 2026-07-27). CoverBand's cover-strip
 * rendering shipped tonight and reads as a broken gray smear at real card sizes — Mike's
 * verdict was blunt. This is the single on/off switch for that rendering, default OFF
 * everywhere, until the visual gets fixed properly.
 *
 * Deliberately a plain const, not a UserPreference row: this is a build-time "is this
 * feature ready" toggle, not a per-user setting anyone should be choosing between. Flip to
 * `true` (or promote to a UserPreference field, following the today_view/energy_filter
 * pattern in prisma/schema.prisma) once the design is actually fixed.
 *
 * Nothing else about covers changes: cover_url assignment (lib/services/cover-assignment.ts)
 * and the stored data on Arc/Task keep running exactly as before — only the render gates.
 */
export const COVERS_ENABLED = false;
