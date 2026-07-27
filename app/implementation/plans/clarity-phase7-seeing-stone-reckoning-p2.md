# Clarity Phase 7 (P2) — Seeing Stone Reckoning, front-page UI + focus mode

Phase 1 (schema/API) is merged. This phase builds the UI against it. Six numbered features,
one commit each. Spec: ~/.claude/tools/oracle/clarity/SEEING-STONE-RECKONING.md ("THE ANSWERED
SPEC" section binding). Inventory: ~/.claude/tools/oracle/clarity/STRUCTURE-INVENTORY.md.

## Files to Create
- [ ] `prisma/migrations/.../migration.sql` — RitualRun model (feature 1)
- [ ] `app/api/ritual-runs/route.ts` — GET/POST (feature 1)
- [ ] `lib/ritual-runs.ts` — pure gate-satisfaction helper (feature 1)
- [ ] `lib/hooks/use-ritual-runs.ts` (feature 1)
- [ ] `components/domain/oracle/RitualGate.tsx` (+ `__tests__`) (feature 1)
- [ ] `components/domain/oracle/today/now-strip-logic.ts` (+ `__tests__`) (feature 2)
- [ ] `components/domain/oracle/today/NowStrip.tsx` (+ `__tests__`) (feature 2)
- [ ] `prisma/migrations/.../migration.sql` — UserPreference.today_view (feature 3)
- [ ] `components/domain/oracle/focus/FocusMode.tsx` (+ logic + tests) (feature 4)
- [ ] `lib/hooks/use-focus-mode.ts` (feature 4)
- [ ] `lib/hooks/use-completion-nudge.ts` (+ constants) (feature 5)

## Files to Modify
- `app/(app)/oracle/page.tsx` — mount RitualGate
- `components/domain/oracle/today/TodaySection.tsx` — NowStrip, lens persistence
- `components/domain/oracle/today/TodayBoard.tsx` — column order, Done collapse
- `components/domain/oracle/today/TodayPickCard.tsx` — reason chip, focus-mode entry
- `components/domain/oracle/today/time-shape-logic.ts` / `TimeShape.tsx` — event/pick dedup
- `lib/hooks/use-today.ts`, `lib/services/today-picks-shape.ts`, `app/api/today/[id]/route.ts` —
  thread task priority/due_date through pick shape (additive select) for honest reason chips
- `lib/hooks/use-preferences.ts`, `app/api/users/me/preferences/route.ts` — today_view field
- `lib/hooks/use-tasks.ts`, `lib/hooks/use-arcs.ts` — surface completion_nudge from PATCH
- `components/domain/oracle/ArcBoard.tsx` — Close arc button (wires existing unused useCloseArc)
- `__tests__/e2e/global-setup.ts` — seed today's ritual-run as ran so existing 36 e2e specs
  are unaffected by the new hard gate
- `__tests__/e2e/oracle-phase4b-peek.spec.ts` — Done column collapsed-by-default means the
  post-reload assertion needs an explicit expand click first

## Verification Checklist (per feature, before each commit)
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm run test:run`
- [ ] `npx playwright test`
- [ ] lint delta vs baseline (705 problems) is zero net-new on touched files
