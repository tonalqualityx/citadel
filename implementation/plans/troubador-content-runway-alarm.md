# Feature: Troubador content-runway alarm

Citadel task `d360b6f0-d65f-490e-b073-62c010c4890f`.

## Overview
Flag a site whose unpublished approved content is nearly exhausted, surface that flag where
Mike and the Troubador worker already look, queue a topic re-evaluation for the site, and
render (never send) the meeting request that refills the pipeline.

Trigger case: Botanical Dream. Its Cycle 2 run is `done` (5 published, 7 postponed) and its
shelf of approved-unpublished articles is empty. Because `/api/troubador/work-queue` only
scans runs in live stages, a site whose runs are all `done` is invisible to it — the alarm
therefore has to be **site-driven**, not run-driven.

## Impact analysis (done 2026-09-10, two sub-agents)
- No internal app code consumes `/api/troubador/work-queue`; the only references are
  `lib/api/registry/troubador.ts:9` and its own test.
- No exported TypeScript type describes the work-queue response, so adding keys breaks no type.
- `lib/troubador/runway.ts` does not exist. The "runway" hits in `components/domain/oracle/`
  are calendar time-blocking, unrelated.
- `publish_per_week` / `lead_time_days` are read in `lib/services/troubador-scheduler.ts:92,101`
  and formatted in `lib/api/troubador-formatters.ts:27-28`.
- Registry test (`lib/api/registry/__tests__/registry.test.ts`) validates registry structure and
  the group list only; it does not cross-check routes against the filesystem.

## Prior art deliberately NOT duplicated
`~/.openclaw/workspace/pipeline/router/runway.py` already implements a retainer-level runway
watcher and the fixed Calendly nudge. It has been dead every morning since at least 2026-09-05:
its `fetch_articles_for_property` GETs `/api/sites/{domain}/articles`, which 404s, so every run
logs `skip_data_unavailable`. That repo's tree is dirty with uncommitted human edits, so it is
out of scope for this pass. The wording of the meeting-request draft here mirrors
`router/config/templates/runway-nudge.txt` so the two stay one voice.

## Files to Create
- [ ] `app/lib/troubador/runway.ts` — pure computation + fixed-template draft rendering, no Prisma.
- [ ] `app/lib/services/troubador-runway.ts` — Prisma reads, returns computed per-site runway.
- [ ] `app/app/api/troubador/runway/route.ts` — `GET`, the ritual data pull's runway surface.
- [ ] `app/lib/troubador/__tests__/runway.test.ts` — unit tests for the pure module.
- [ ] `app/app/api/troubador/runway/__tests__/route.test.ts` — route tests.

## Files to Modify
- [ ] `app/app/api/troubador/work-queue/route.ts` — emit `reevaluate_topics` items for
      low-runway sites and a top-level `runway` block.
- [ ] `app/lib/api/registry/troubador.ts` — register the new endpoint, update the work-queue entry.
- [x] `~/.claude/skills/troubador/references/citadel-worker.md` — teach the worker the new action,
      including that the task it files must carry `site_id` and the `content-runway` tag (those are
      what the suppression reads), and that the re-evaluation run it opens stays at `ready=false`
      so the human topic gate is untouched.

## Definitions
- **Shelf** = non-deleted articles with status `approved` or `scheduled` and no `published_url`.
  `postponed` and `dropped` are parked, not shelf.
- **Cadence** = the site's active schedule `publish_per_week`, else the schema default 2
  (`cadence_source` records which).
- **runway_days** = `floor(shelf / publish_per_week * 7)`.
- **trigger_days** = schedule `lead_time_days` (default 7) + 7 days buffer. `low_runway` when
  `runway_days <= trigger_days`.
- **Watched site** = has an active schedule, OR a run in a live stage, OR published a Troubador
  article in the last 90 days. The third clause is what catches Botanical Dream and is also what
  ages a long-finished site off the alarm instead of nagging forever.
- **Suppression.** The `reevaluate_topics` queue item is withheld for a site that already has a run
  in a live stage, or an open task tagged `content-runway`. The second guard exists because the
  Troubador worker's cost gate only skips a spawn when the previous pass reported no action: an
  alarm item that stayed in the queue after the worker acted on it would respawn an LLM session
  every 15 minutes for as long as the site stayed dry. The site is still reported as low runway
  either way; only the actionable item is withheld.
- `unscheduled_count` (shelf articles with no `scheduled_date`) is reported separately: the
  publish driver only dispatches dated articles, so a full shelf can still be unpublishable.

## Implementation Steps
1. Write `lib/troubador/runway.ts` (constants, `computeSiteRunway`, `renderMeetingRequestDraft`).
2. Write `lib/services/troubador-runway.ts` (`getSiteRunways`).
3. Add `GET /api/troubador/runway`.
4. Extend the work-queue route.
5. Update the registry.
6. Tests, then gates.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/troubador/work-queue/__tests__/route.test.ts` — its Prisma mock exposes only
      `troubadorRun.findMany`. The route now also calls the runway service, so the test must mock
      `@/lib/services/troubador-runway`; without it every existing case throws.

## Tests to Write
- [ ] Empty shelf → runway 0, `low_runway` true.
- [ ] Full shelf at cadence → runway above trigger, `low_runway` false.
- [ ] `postponed` / `dropped` / already-published articles never count as shelf.
- [ ] Shelf articles with no `scheduled_date` count as shelf but raise `unscheduled_count`.
- [ ] Cadence falls back to the default when no active schedule exists, and says so.
- [ ] Draft rendering fills every slot and leaves no unreplaced placeholder.
- [ ] Work queue emits `reevaluate_topics` for a low-runway site.
- [ ] Work queue suppresses it when the site already has a run in a live stage.
- [ ] Existing work-queue publish/draft/rewrite cases still pass.

## Adversarial review findings, fixed before push
A fresh-context reviewer read the whole change against the schema and the external worker script.
Four real defects, all fixed and each now covered by a test:
1. The client note told the client to book by a date already in the past whenever the shelf was
   emptier than one lead time — i.e. in the worst cases, where the wording matters most. The date
   now floors at today, and the sentence switches from promising the schedule stays intact to
   saying plainly that there will be a gap. The original test had asserted the wrong behaviour.
2. `prisma.site.findMany` did not filter `is_deleted`. Deleting a site cascades to nothing in
   Troubador, so a torn-down engagement would keep alarming and keep drafting notes to its former
   client.
3. Client identity came from `Site.client_id`, which is optional and is never checked against the
   `client_id` a schedule is created with. It now comes from Troubador's own rows (schedule, then
   live run, then article) and falls back to the site record.
4. The article query loaded every published article ever, on every 15-minute poll, to answer a
   90-day recency question. The published branch is now bounded by that window.

Not fixed, recorded instead: the suppression depends on the Troubador worker actually filing its
task with `site_id` and the `content-runway` tag. If it does not, the alarm re-queues about once a
day (`urgency_date` is date-granularity), not every tick. Named in the worker contract as
load-bearing.

## Verification Checklist
- [x] `npx tsc --noEmit` — exit 0
- [x] `npm run test:run` — 258 files / 3155 tests, exit 0
- [x] `npm run build` — exit 0, `/api/troubador/runway` in the route manifest
- [x] `npx eslint` over every changed file — exit 0, no errors and no warnings.
      Repo-wide `npm run lint` is red at baseline (494 errors, none in these files) and was
      already red before this change.
