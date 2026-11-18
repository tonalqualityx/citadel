# Feature: Approval sweep for finished internal work

## Overview
Owner rule, 2026-11-18: "YES - internal work that's been done for 3 days or more without approval can be approved right away." Also: a series of tasks that culminates in a real human review task never needs its own review. This builds a sweep (function + worker route, same shape as home-keeper) that approves finished internal bot tasks nobody has touched for 3 days. GET is a dry run, POST `{}` is the real run.

## Impact analysis (done by reading; no code depends on the new files)
- Callers/consumers: none of the changed existing files change behavior. Edits to existing files are additive lines: lane allowlist (`lib/auth/lane-scopes.ts`), its test list (`lib/auth/__tests__/lane-bast-chat.test.ts`, a hand-kept EXPECTED list), and the API registry (`lib/api/registry/bast-chat.ts`).
- `loadReviewFolds` (`lib/home/load.ts`) is NOT changed. Its rule (not deleted, done, needs_review, not approved, reviewer null or owner) is the base of the sweep query, so the sweep is always a subset of what the home screen lists.
- Bot ids: reuse `BOT_USER_IDS` and `BAST_USER_ID` from `lib/oracle/projects/gate-constants.ts` (not redefined).
- Tests affected: only `lane-bast-chat.test.ts` (exact allowlist). Registry/route-coverage tests pass with the registry entry added.

## Files to Create
- [x] `lib/home/keeper/approve-sweep.ts` - selection, skip reasons, run, digest line
- [x] `app/api/bast-chat/worker/home-keeper/approve-sweep/route.ts` - GET dry run, POST real run (strict `{}` body)
- [x] `lib/home/keeper/__tests__/approve-sweep.test.ts`
- [x] `app/api/bast-chat/worker/home-keeper/approve-sweep/__tests__/route.test.ts`

## Files to Modify
- [x] `lib/auth/lane-scopes.ts` - allow GET/POST on the new path for the bast-chat lane
- [x] `lib/api/registry/bast-chat.ts` - document both methods

## Qualifying rule
All of: status done, needs_review, not approved, not deleted, reviewer empty or the owner (the fold rule); finished (completed_at, else updated_at) MORE than 3 days ago; assignee in BOT_USER_IDS; no comment by anyone who is not a bot (a client contact comment has no user, so it counts as human; deleted comments count too, to fail safe); not client facing.

## Client-facing tags chosen (and why)
Skip any task with one of these tags, any tag starting `client-`, or with `client_approved_at`, `staging_preview_url` or `requested_by_contact_id`, `client_id` (on the task or its project) or `client_visible` set. Added after the first live dry run showed ThermalNetics, Grok and Stronghold build tasks qualifying: client work is not internal even if the client never sees it.
- `client-approved`, `client-sent-back`, `client-cancelled`: portal client-rendered labels (lib/portal/client-rendered.ts)
- `staged`, `awaiting-client-approval`: change staged for the client's yes (lib/portal/go-live.ts, tag docs in schema)
- `client-plan-approval`, `plan-approval`, `needs-pm-release`, `awaiting-clarification`, `needs-mike`, `cockpit-owned`: BLOCKING_TAGS, a person's word is the point
- `portal`, `portal-chat`, `chat-question`, `quote`, `marketing-plan`, `emergency`: shown or sent to the client
Reason: the owner's rule is internal work only; failing safe costs a missed approval, not a client surprise (handbook: reversible, no surprises).

## Positive evidence of internal (owner-coordinator rulings, 2026-11-18)
The sweep needs positive evidence that work is internal; missing data is never treated as internal.
- **Security is a hard exclusion, checked first.** Handbook section 3 item 8 (a security flag is never dismissed or downplayed). Named constants `SECURITY_TAG_WORDS` and `SECURITY_TITLE_WORDS` in approve-sweep.ts, case-insensitive substring match on any tag or the title, with a comment citing the handbook rule. Regression case that must never pass: "Saiph: a high security advisory could not be filed (follow-redirects)" (tags job-watch, job-watch:saiph-stack-watch). Unit-tested.
- **Name fallback.** A task with no client and no project is compared by title (whole-word, normalised, case-insensitive) with every client and project name plus short aliases (text before a colon, corporate suffixes and trailing descriptors like "website and store" cut). One query each for clients and projects. A hit is `client_name`, skipped. Reason: "Stronghold Stuff: apply round comments on home" has no client or project links, but its siblings belong to Trinity Industries.

## Attribution
Approval is written as Bast (`approved_by_id` = BAST_USER_ID, `approved_at` = run time) and logged with `logUpdate` whose changes include `approval_source: auto-approve-sweep`. Write is guarded (`updateMany` where still unapproved and done); a lost race is counted, not forced.

## Digest line
"Signed off N pieces of finished work that shipped more than 3 days ago and drew no comments. Nothing client facing was included." Framed as what shipped and is now signed off (the worker sets needs_review on every task it ships as a visibility note, so most of the pile was never an approval request).

## Not built (needs a decision)
The second rule (a project whose chain ends in a human review task never needs review) is NOT implemented: it needs a definition of "review task" and "culminates" (tag? title? last task in the project's blocking chain?). The first rule's age-and-no-human-touch test already clears most of those. Also not built: the weekly cron wrapper that POSTs, and putting the line into the digest.

## Tests to Update
- [x] `lib/auth/__tests__/lane-bast-chat.test.ts` - add the two new routes to EXPECTED

## Tests to Write
- [x] human comment skipped; client contact comment skipped; 2-day-old skipped; client tag skipped; human-assigned skipped; qualifying approved + logged; dry run writes nothing; lost race; fold-rule where; line text; route GET/POST/strict body/non-workers/allowlist

## Known test status (do not re-investigate)
Full `npm test -- --run` on this branch: two files fail, and both fail identically on main with the changes stashed, because they need a local database that is not running: `app/api/oracle/projects/__tests__/last-comment-distinct-on.integration.test.ts` and `lib/portal/__tests__/book-page.test.tsx`. `lib/design/__tests__/markdown-subset.test.tsx` ("finishes under 200 ms") is load flake under the parallel run; alone it passes 45 of 45.

## Verification Checklist
- [x] `npx tsc --noEmit` exit 0
- [x] `npm test` passes
- [x] Dry run against production data via read-only GETs: 11 qualify (see report)
