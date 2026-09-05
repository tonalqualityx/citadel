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

/**
 * Oracle Projects Tab (spec blessed by Mike 2026-09-04,
 * implementation/plans/oracle-projects-tab.md). Master switch for the 4th Oracle mode.
 * Plain const, not env-gated: Phase 1 ships the tab (as a placeholder) turned on.
 */
export const ORACLE_PROJECTS_TAB = true;

/**
 * Oracle Projects Tab — hides the Plan and Process tabs once Projects ships, per the
 * spec's "Plan and Process tabs hidden behind a flag" ruling. Unlike ORACLE_PROJECTS_TAB
 * this reads an env override so `playwright.config.ts` can force it `false` for the 14
 * existing Plan/Process-tab e2e specs, which stay valid until those panes are retired —
 * see mode-shell-logic.test.ts and ModeShell.test.tsx for the two-flag-case unit coverage.
 * Only the literal string 'false' disables it; any other value (including unset) keeps
 * the shipped default of true.
 */
export const ORACLE_HIDE_PLAN_PROCESS =
  process.env.NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS !== 'false';
