# Feature: Bast chat, start a project and start a quote (Citadel side)

Condensed from /home/mike/Documents/projects/system-review-2026-11/specs/bast-chat-start-plan.md (2026-11-10). Owner-only internal tool. No adversarial hardening, no new locking, schema, routes, lane entries or card kinds. Pattern: `app/lib/bast-chat/ops/project.ts`.

## Overview
Two new chat operations on POST /api/bast-chat/worker/ops, applied at once in one transaction, Undo for 24 hours, nothing deleted.
- `start_project`: optional new client, a project in status `queue` (hidden from the client), a kickoff task for the owner (no project on the task, because the home screen hides tasks of hidden projects). Record target_type `project_start`.
- `start_quote`: a deal (`Accord`, status `lead`, no value, no Proposal) and a pricing task for the owner (no project). Record target_type `quote_start`. With an email ask id, the sender and thread are read on the server.
No billing, budget, rate, deal value or Proposal write anywhere. Nothing is sent.

## Files to Create
- [x] `app/lib/bast-chat/ops/start-common.ts` shared helpers (site pick, plain description and checklist, task create, shared Undo check)
- [x] `app/lib/bast-chat/ops/start-project.ts`
- [x] `app/lib/bast-chat/ops/start-quote.ts`

## Files to Modify
- [x] `app/lib/bast-chat/ops/index.ts`: two `define(...)` lines and the header table
- [x] `app/lib/bast-chat/actions.ts`: two `OpLine` cases in `opSummary`
- [x] `app/app/api/bast-chat/worker/ops/route.ts`: doc comment only
- [x] `app/lib/api/registry/bast-chat.ts`: registry notes
- No change: schema, lane scopes, panel, `apply.ts`, task, project, deal and client routes.

## Behaviour
start_project input `{client_id | new_client (exactly one), what, name?, site?, message}`. Line: `Started "<name>" for <client>. It is hidden from the client until you say it is live.` plus ` Added <client> as a new client.` when created. Refuses a new client whose name an active client already has. Kickoff task: title `Kick off <name>`, owner, `not_started`, tags `from-chat` and `kickoff`, client and site set, no project, no due date, three checklist lines, description holds the project id and link and the owner's message word for word. Undo: refused ("Changed since. Open the project.") unless the project is still `queue`, the task still the owner's and `not_started`, nothing waits on it; then `checkUndo` and one transaction with compare-and-set: project to `cancelled`, task to `abandoned`; a created client stays.

start_quote input `{client_id | lead_name | lead_business | lead_email | email_ask_id (at least one; client_id not with lead_*), what, message}`. Line: `Started a quote for <who>: <what>. Nothing is priced or sent.` Pricing task `Price <what> for <who>`, tags `from-chat` and `quote`, linked to the deal and client, no project, checklist of four lines (the Gmail line only with a thread). Undo: refused ("Changed since. Open the deal.") unless the deal is still `lead` and the task still the owner's and `not_started`; then deal to `lost` (lost_at, reason "Started by mistake from the chat") and task to `abandoned`.

Reach: `prepare` runs `checkTaskCreate` on the planned task (assigned to the owner, so no tap). No new rule.

## Tests to Update (from impact analysis)
- [x] `ops-route.test.ts`: two new cases through the route (existing cases unchanged)

## Tests to Write
- [x] `ops/__tests__/start-project.test.ts` (mocked database)
- [x] `ops/__tests__/start-quote.test.ts` (mocked database)
- [x] `ops/__tests__/start.integration.test.ts` (scratch Postgres on localhost:55433)

## Verification Checklist
- [ ] `npx tsc --noEmit`
- [ ] new and touched tests, full `npx vitest run` (same failures as main: last-comment-distinct-on.integration, book-page, gate-constants.drift)
- [ ] integration test on a scratch database
- [ ] `npm run build`
- [ ] `git diff main --stat` touches only app/lib/bast-chat, the ops route comment, registry notes, implementation/plans
- [ ] no em or en dash in the new chat files
