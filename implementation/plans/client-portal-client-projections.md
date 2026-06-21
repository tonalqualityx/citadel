# Feature: [A2] Client Portal — client-view projections (task + article)

## Overview
Add serializers that expose ONLY client-safe fields for tasks and articles, so the
forthcoming client-portal endpoints (C-series) can never leak internal data. Builds on
A1 (`is_internal` comment flag + `lib/comments/visibility.ts`).

## Client-safe field policy
**Task → client:** id, title, description, status, time estimate (estimated_minutes),
client-visible comments, created_at, updated_at.
**Article → client:** id, title, status, body, client-visible comments, created_at, updated_at.

**Hidden (never projected):** energy_estimate, mystery_factor, battery_impact, all billing
(is_billable, billing_target/amount, is_retainer_work, is_support, invoiced*),
review_requirements, requirements, priority, source/source_ref/provenance, assignee/reviewer/
created_by/approved_by internals, sop/function, notes, blocked_by/blocking, time_entries, sort_order,
internal IDs (project_id, client_id, site_id, etc.). For articles also hidden:
research_summary, check_state, check_report, social_copy, locked, claimed_*, run_id, client/site,
approved_by internals, suggested/scheduled dates.

Comments are filtered to client-visible only (reuse `filterClientVisible` — drops
`is_internal === true`; article comments have no such flag yet so all pass — forward-compatible).
Comment shape exposed to clients: id, content, created_at, author_name (no email/avatar/id/is_internal).

## Files to Create
- [ ] `app/lib/api/client-projections.ts` — `formatTaskForClient`, `formatArticleForClient`, client comment helper
- [ ] `app/lib/api/__tests__/client-projections.test.ts` — tests incl. exhaustive no-leak assertion

## Files to Modify
- (none) — no client-facing endpoints exist yet (C1 magic-link login not built). These projections
  are the building block the C-series will consume. Wiring happens when those endpoints land.

## Implementation Steps
1. Create `client-projections.ts` reusing `parseJsonField` (description/body) and
   `filterClientVisible` (comments).
2. Use an explicit allow-list object literal (not a denylist) so new internal fields can't leak by default.
3. Tests: assert exact key sets, presence of allowed fields, absence of every internal field,
   and that `is_internal:true` comments are dropped.

## Tests to Update (from Impact Analysis)
- None. New file only; no existing signatures change. `formatTaskResponse`/`formatArticleResponse`
  untouched, so their tests (`bast-fields-formatters.test.ts`, `formatters-phase3.test.ts`,
  troubador article tests) are unaffected.

## Tests to Write
- [ ] formatTaskForClient: exact allowed key set; exposes title/description/status/estimated_minutes/comments
- [ ] formatTaskForClient: NO billing/energy/mystery/battery/review_requirements/priority/assignee leak
- [ ] formatTaskForClient: filters is_internal comments; client comment shape has no email/avatar/is_internal
- [ ] formatArticleForClient: exact allowed key set; exposes title/status/body/comments
- [ ] formatArticleForClient: NO research_summary/check_state/check_report/locked/claimed/client/site leak
- [ ] formatArticleForClient: forward-compatible is_internal article-comment filtering

## Verification Checklist
- [ ] tsc --noEmit clean
- [ ] vitest run green (new + existing)
- [ ] next build succeeds
- [ ] one reversible commit; push to main (auto_deploy=true); CI green
