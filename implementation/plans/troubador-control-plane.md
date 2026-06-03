# Feature: Troubador Control Plane

## Overview
A "Troubador" section in Citadel — the control plane for content-production runs. Schedules spawn
Runs (per client+site); Runs contain Articles; a terminal Troubador worker (Bast-machine cron)
polls Citadel, does machine work in clean contexts, writes results back via upserts, and advances
state. Humans hold the gates (ready / selection_ready / approval) and do the live interview in CLI.

Full design: `feature-planning/troubador-control-plane-design.md` (authoritative).

**Scope of THIS build:** board-first control plane — schema, API + registry, server-side
scheduler, board + run detail UI, schedules UI, dashboard queue + notifications, publishing
calendar. **Publishing execution is deferred** (Bast cron, later); Site publish-config fields are
reserved now.

## Known blocker (needs Reshi)
- The `citadel_dev` Postgres is not running; port 5432 is held by `quorionis-postgres`. Applying
  the Prisma migration requires freeing that port (likely stopping the quorionis container) — a
  cross-project decision deferred to Reshi. **Workaround used:** `prisma generate` (no DB needed)
  so all code typechecks and tests run; only `prisma migrate dev --name troubador_control_plane`
  is left pending.

## Files to Create
- [ ] `app/lib/api/registry/troubador.ts` — endpoint registry for the Troubador group
- [ ] `app/app/api/troubador/work-queue/route.ts` — worker queue (GET)
- [ ] `app/app/api/troubador/schedules/route.ts` (GET list, POST create)
- [ ] `app/app/api/troubador/schedules/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/app/api/troubador/runs/route.ts` (GET board/list, POST create manual run)
- [ ] `app/app/api/troubador/runs/[id]/route.ts` (GET detail, PATCH gates/assignee)
- [ ] `app/app/api/troubador/runs/[id]/proposals/route.ts` (worker POST upsert, human PATCH select/add)
- [ ] `app/app/api/troubador/runs/[id]/research/route.ts` (worker POST per-article research)
- [ ] `app/app/api/troubador/runs/[id]/interview-questions/route.ts` (worker POST)
- [ ] `app/app/api/troubador/runs/[id]/interview-complete/route.ts` (CLI skill POST → In Production)
- [ ] `app/app/api/troubador/runs/[id]/claim/route.ts` + `app/app/api/troubador/articles/[id]/claim/route.ts` (lease)
- [ ] `app/app/api/troubador/articles/[id]/route.ts` (PATCH: worker draft/status, human approve/drop/postpone/edit/date)
- [ ] `app/app/api/troubador/articles/[id]/comments/route.ts` (POST feedback → needs_revision)
- [ ] `app/app/api/troubador/calendar/route.ts` (GET publishing calendar by site)
- [ ] `app/app/api/troubador/dashboard/route.ts` (GET editor work queue) — OR fold into existing dashboard
- [ ] `app/lib/api/troubador-formatters.ts` — formatRun/formatArticle/formatSchedule/formatProposal
- [ ] `app/lib/services/troubador-scheduler.ts` — derive next-run, instantiate runs (cadence/lead-time/stack/skip/no-backfill)
- [ ] `app/app/api/cron/troubador-scheduler/route.ts` — cron trigger for the scheduler (x-cron-secret)
- [ ] `app/lib/hooks/use-troubador.ts` — React Query hooks (runs, schedules, articles, proposals, calendar)
- [ ] `app/lib/api/query-keys.ts` additions (troubadorKeys) — or new file if pattern differs
- [ ] `app/app/(app)/troubador/page.tsx` — board
- [ ] `app/app/(app)/troubador/runs/[id]/page.tsx` — run detail (article table + tabs)
- [ ] `app/app/(app)/troubador/schedules/page.tsx` — schedules list
- [ ] `app/app/(app)/troubador/calendar/page.tsx` — publishing calendar
- [ ] `app/components/domain/troubador/*` — board, run-card, article-table, article-detail, schedule-form, feedback-thread
- [ ] Tests: registry, scheduler logic, key API handlers (article transitions, gate enforcement, work-queue)

## Files to Modify
- [ ] `app/prisma/schema.prisma` — 6 new enums extended/added; 5 new models + Interview; Site
      publish-config fields; back-relations on Client, Site, User; new NotificationType values
- [ ] `app/lib/api/registry/index.ts` — import + spread `troubadorEndpoints`; add enums to `apiEnums`
- [ ] `app/lib/api/registry/__tests__/registry.test.ts` — add `troubador` to `expectedGroups`
- [ ] `app/lib/services/notification-preferences.ts` — DEFAULT_PREFERENCES for new notif types
- [ ] `app/components/layout/Sidebar.tsx` — add Troubador NavSection
- [ ] `app/app/api/dashboard/route.ts` + `app/components/domain/dashboard/pm-overlook.tsx` — add
      "Troubador: articles awaiting review" section (PM/admin)
- [ ] `app/prisma/seed.ts` (or scripts) — seed the "Troubador" service User + API key (if seed exists)

## Implementation Steps
1. **Schema** — add enums, models, Site fields, back-relations (named relations per impact report:
   `troubador_runs_assigned`, `troubador_schedules_default_editor`, `articles_approved`,
   `article_comments`), new NotificationType values. `prisma format` + `prisma validate` +
   `prisma generate`. (Migration apply deferred — blocker above.)
2. **Formatters** — `troubador-formatters.ts` shaping API responses (ISO dates, nested client/site).
3. **Registry** — `troubador.ts` + wire into index + `apiEnums`; update `expectedGroups` test.
4. **API routes** — worker endpoints (upsert, lease, gate-respecting) + human endpoints
   (CRUD, approve/drop/postpone, feedback, calendar). `requireAuth`/`requireRole`/Zod/`handleApiError`,
   soft-delete, activity logging, bot identity for worker writes.
5. **Scheduler service + cron route** — next-run derivation (keep-calendar-full + lead time),
   stack policy, skip-once, no-backfill; notify assignee on run creation.
6. **Notifications** — new types (`article_needs_review`, `troubador_run_created`), preference
   defaults, creation calls in the relevant handlers.
7. **Hooks** — `use-troubador.ts` query/mutation hooks + query keys.
8. **UI** — sidebar entry; board (dnd columns, run cards with review-needed badge); run detail
   (article table with approve/drop/postpone/date + article detail w/ inline edit + feedback
   thread); schedules page (+ client Publishing tab); calendar page.
9. **Dashboard** — add Troubador awaiting-review section.
10. **Tests** — registry, scheduler unit tests, API handler tests (transitions, gate enforcement),
    run all + `tsc --noEmit`; zero broken tests.

## Tests to Update (from Impact Analysis)
- [ ] `app/lib/api/registry/__tests__/registry.test.ts` — add `'troubador'` (and any other new
      group) to the `expectedGroups` whitelist (line ~51). This is the ONLY required edit to
      existing tests; all other tests mock Prisma and are unaffected by additive schema changes.

## Tests to Write
- [ ] Scheduler: next-run derivation, stack policy (skip when open run + flag false), skip-once,
      no-backfill, start-date gating.
- [ ] Article PATCH: legal transitions; worker cannot set `approved`; approve locks copy;
      drop/postpone semantics; date collision avoidance (same-site).
- [ ] Gate enforcement: worker endpoints refuse to advance past unset human gates.
- [ ] Work-queue: returns only actionable items, ordered by urgency, respects leases.
- [ ] Registry shape conformance (covered by existing registry.test once group whitelisted).

## Verification Checklist
- [x] `npx prisma validate` passes; `npx prisma generate` succeeds
- [x] `npx tsc --noEmit` clean
- [x] `npm run test:run` green (845 passed, 0 failed — incl. 16 new Troubador tests)
- [x] Registry served correctly (new endpoints present, no duplicate paths — registry.test passes)
- [x] Migration file staged & ready to apply once DB is available (Reshi) — `prisma/migrations/20260603120000_troubador_control_plane/`
- [x] Lint: new code matches repo convention (only `where: any`, same as existing routes/formatters)
- [ ] **PENDING (Reshi): apply migration** — free port 5432 (quorionis-postgres), then `cd app && npx prisma migrate dev` (or `migrate deploy`)
- [ ] No push to production / no deploy without Reshi approval

## Skill-side worker — NOT BUILT (follow-up)
The Citadel control plane + API are done. The **Troubador skill itself has no Citadel-worker
loop yet** — it still writes files to `~/Documents/Troubador/`. A follow-up is needed to teach the
skill to operate the board via the API. Required skill behaviors:
- Poll `GET /api/troubador/work-queue` (auth as the "Troubador" service user via API key) and act on
  each item: `generate_proposals`, `create_articles`, `research_article`, `post_interview_questions`,
  `draft_article`, `rewrite_article` (and later `publish_article`).
- Claim leases (`/runs/:id/claim`, `/articles/:id/claim`) before working an item.
- **Interview completion is NOT a UI button (by design).** When the human finishes the live CLI
  interview for a run, the skill must call `POST /api/troubador/runs/:id/interview-complete` itself
  (with the transcript) to advance the run to In Production. The board intentionally has no
  human "mark interview complete" control.
- Respect human gates — never advance past `ready` / `selection_ready` / approval.

## Status: BUILD COMPLETE — Citadel side (pending prod migration + skill-side worker)
Citadel control plane code written, typechecks, tests pass; migration applied to local DB (5433)
and exercised end-to-end via manual worker calls. Committed to branch `feat/troubador-control-plane`.
Deferred by design: publishing execution (Bast cron) and the **skill-side worker** (above).
```
