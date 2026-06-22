# Feature: Wire becomeindelible.com publish config + Troubador approve→publish work-queue link

Task: `1edc116f-f95e-460d-80e3-26f3d1bc7f8c` (site: Citadel, auto_deploy=true → push to main)

## Overview
Two parts:
- **Part 1 (data, land now):** Populate the becomeindelible.com Site record from the on-machine
  Eleventy checkout (`~/Documents/Wright/sites/indelible`). Low-risk config; flag the missing git remote.
- **Part 2 (code, safe + tested):** Close the Citadel-side pipeline dead-end so an *approved* article
  is actually surfaced to the (external, not-yet-built) Troubador worker as `publish_article` work.

## Root cause found (Part 2)
When an article hits `approved`, `recomputeProductionStage` advances its run to stage **`publishing`**.
But `app/app/api/troubador/work-queue/route.ts` only scans runs in
`['planning','topic_selection','researching','in_production']` — it **excludes `publishing`**. So
approved/scheduled articles are invisible to the worker. That is exactly "Approve stamps the sign-off…
nothing publishes." (Even the pre-existing `scheduled` publish branch can never fire, for the same reason.)

## Part 1 — Site record (becomeindelible.com, id 171b10a6-2d81-4d79-b637-1b729b633bb9)
Values pulled from `wright.config.json` / package.json / git in the local checkout:
- `site_type`: stays `eleventy` (confirm) — package.json @11ty/eleventy ^3.0.0, build `eleventy`.
- `prod_branch`: `main` (wright.config deploy.branch_env.prod).
- `staging_branch`: `staging` (wright.config deploy.branch_env.staging).
- `content_dir`: `src` (wright.config content_dir; Eleventy input dir).
- `repo_url`: **leave null** — local checkout has NO git remote configured → FLAG: GitHub repo needs wiring.
- `handoff_method`: leave null — self-deploying Eleventy site (GH Action rsync-ssh to Cloudways), not a handoff.
- Do NOT touch `auto_deploy` (stays false; flipping live publishing is gated on Mike's go).
- Done via `PATCH /api/sites/:id` (Bast is `pm` → authorized). Old values recorded for reversibility.

## Files to Modify (Part 2 — code)
- [ ] `app/app/api/troubador/work-queue/route.ts` — include `publishing` runs; surface `publish_article`
      for `approved` articles (lease-guarded) alongside the existing `scheduled`-due path; run the
      publish checks for both `in_production` and `publishing` stages.
- [ ] `app/lib/api/registry/troubador.ts` — update work-queue responseNotes (publish_article surfaced
      for approved + scheduled-due across in_production/publishing).

## Files to Create
- [ ] `app/app/api/troubador/work-queue/__tests__/route.test.ts` — new test (none existed).

## Tests to Update (from Impact Analysis)
- None. No existing test references the work-queue (confirmed by search). Article PATCH / run-stage /
  comments tests are unaffected (no signatures or shapes change).

## Tests to Write
- [ ] approved article (run in `publishing`) → emits `publish_article`.
- [ ] approved article with an active lease → NOT emitted.
- [ ] scheduled article past its date (run in `publishing`) → emits `publish_article` (regression: was unreachable).
- [ ] scheduled article with a future date → NOT emitted.
- [ ] in_production run with researched/needs_revision → still emits draft/rewrite (no regression).

## Safety / gate (the task's "do not auto-publish blindly")
Surfacing a queue item ≠ publishing. Actual publish stays gated by ALL of:
- the external Troubador worker loop (Python, in the skill) — **not yet built** (out of this repo);
- the target site having a `repo_url` — becomeindelible.com has none (publish lib bails "site.repo_url is required");
- the relaunch settling + Mike's explicit go before wiring the repo / flipping auto_deploy.
No DROP/destructive migration; no schema change; one reversible commit.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] new work-queue tests pass + full suite green (zero broken)
- [ ] `next build` succeeds
- [ ] Part 1 Site record reflects the values; missing-remote flagged to Mike
- [ ] One reversible commit; CI green after push
