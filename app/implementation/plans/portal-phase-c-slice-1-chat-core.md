# Feature: Portal phase C, slice C1 (chat core)

Spec: `/home/mike/Documents/indelible-ops/specs/client-portal-phase-C-chat-SPEC.md` (sections 3, 4.1, 5.3, 5.4, 9, 10, 11.1, 11.2, 11.8 row C1).
Branch `portal/c1-chat-core`, cut from `main` (1864720). Mode ships OFF; nothing here is client-visible.

## Overview
The Citadel half of the chat that nothing calls yet: schema, the engine queue (enqueue, absorb, claim with
SKIP LOCKED, lease, heartbeat, expiry), the tool-call log, the read route, the switches/settings/status,
the copy gate with provenance masking, the context bundle, spend/rate caps, and the SitePage table with its
bot-written pages API. Machine side: `sync_site_pages.py` and a dry-run-only `backfill_analytics_ids.py`.

## Impact analysis (done before code)
Codebase:
- `NotificationType` gains `portal_chat_handoff`: the five `Record<NotificationType, ...>` maps
  (`use-notification-preferences.ts` x2, `email-notifications.ts` x2, `slack-notifications.ts`,
  `notification-preferences.ts`) need an entry; tsc finds any miss.
- `formatSiteResponse` (lib/api/formatters.ts) feeds `GET /api/sites` and `PATCH /api/sites/:id`: adds the three
  new Site fields. `PATCH /api/sites/:id` stays pm/admin, but the three new fields need admin or the Bast user.
- `app/api/portal/projects/[id]/route.ts` holds the project view inline; the engine read `project` needs the same
  shape, so the body moves to `lib/portal/project-detail.ts` and the route calls it (route test must stay green).
- `PROMISES` lives in `lib/portal/intake/__tests__/promise-scan.ts`; production code (gate.ts) may not import from a
  tests folder, so it moves to `lib/portal/intake/promises.ts` and the test helper re-exports it.
- `Comment`, `EmailOutbox`, `AppSettings`, `Site`, `ApiKey`: additive columns only; nothing renamed or made required.
- Engine scope: `ApiKey` has no scope today. Adds `scopes String[] @default([])`; `requireEngine()` accepts only a
  bearer key whose scopes include `engine` (cookies never count), so the portal/staff keys cannot claim.
Tests:
- `lib/api/registry/__tests__/registry.test.ts` (every route must be registered, shape checks): new registry files
  `engine.ts`, `portal-chat.ts`, entries in `sites.ts`; index.ts wiring.
- `app/api/sites/__tests__/route.test.ts`, `app/api/sites/[id]/__tests__`: formatter now returns 3 more fields.
- `app/api/portal/projects/__tests__/route.test.ts`: unchanged behavior after the extraction.
- `lib/portal/intake/__tests__/*` use PROMISES through the re-export.
- notification preference tests that enumerate every type (`notification-preferences.test.ts`) get the new type.

## Files to create
- `prisma/migrations/20261022000000_portal_c_chat_core/migration.sql`
- `lib/engine/{auth,queue,reads,tool-calls}.ts`; `lib/portal/chat/{gate,provenance,context,caps,switches}.ts`, `copy.ts` (only the strings this slice shows), `lib/portal/project-detail.ts`, `lib/portal/intake/promises.ts`
- Routes: `api/engine/claim`, `api/engine/jobs/[id]/{heartbeat,tool-calls,read/[kind]}`, `api/portal-chat/{status,settings}`, `api/sites/[id]/pages`
- Registry: `engine.ts`, `portal-chat.ts`; sites.ts entries
- Machine: `~/.claude/tools/portal-chat/{sync_site_pages.py,backfill_analytics_ids.py,tests/}`; `flags.yaml` entry + `flags.py` probe `portal-chat`

## Files to modify
- `prisma/schema.prisma`; `lib/api/formatters.ts`; `app/api/sites/[id]/route.ts`; `app/api/portal/projects/[id]/route.ts`;
  the notification label maps; `lib/api/registry/index.ts`, `sites.ts`.

## Not in C1 (later slices, per section 11.8)
`complete`/`fail` routes and `apply.ts` (C2: they need the actions), runner and MCP server (C2), UI and staff
settings page (C3), mailer/sweep/inbound (C4). The queue library has the status transitions C2 will call.

## Tests to write
queue (claim race between two claimers on a real scratch Postgres, absorb, follow-up behind a claimed job, lease,
heartbeat cap, expiry to tree), auth (scope), tool-calls (cap 20 KB, number extraction, 6-call and 40-a-day caps),
reads (scoping per role, expired job refused), gate (every rule + 80 must-fail / 50 must-pass fixtures + prose-gate.sh
parity), provenance (masking, precision, percent, money from invoices only), context (two seeded clients, no ids,
escaping), caps and switches (each condition, dead runner), settings route (bot may only turn off), pages route.
Python: sync_site_pages and backfill unit tests with mocked HTTP.

## Verification checklist
- [ ] prisma validate; migrate on scratch db citadel_c1_scratch with no drift
- [ ] tsc --noEmit; vitest on the slice paths; next build; python3 -m unittest for the two scripts
