# Feature: Portal phase B, slice 1 (request intake and Requests view)

Spec: /home/mike/Documents/indelible-ops/specs/client-portal-phase-B-SPEC.md (slice 1). Branch `portal/b1-requests`, cut from `portal/hotfix-button-colors` (the invisible-button fix).

## Overview
A client files work from the portal through a fixed question tree (no model call). The request is one Citadel task, placed by a pure function that mirrors inbound placement rule 6, with the scope gate (quote) and emergency effects decided at filing. A Requests list and a read-only work page show it back in client words, with an engagement chip (Project, Retainer or Request).

## Impact analysis (done before code)
- `app/api/portal/home/route.ts`: existing test counts `task.findMany` calls and call order; the requests load goes last so indices hold, and the grant-scope count test moves 4 to 6.
- `app/api/tasks/[id]/route.ts`: two exit paths (status-only, regular update); the hook is best effort and portal-only so existing mocks never reach it.
- `lib/waits/templates.test.ts`: template counts, live keys and the blocks-client list change; `sweeper.test.ts` gets the `portal_answered` cases.
- `NotificationType` gains `portal_emergency`: five `Record<NotificationType, ...>` maps need an entry (tsc finds them).

## Files
Schema and migration, intake lib (tree, placement, compose, file-request, classify), engagement, requests, waits, status labels, template and sweeper changes, flag, three routes plus home and task hooks, registry, three pages, intake components, chips, row, button, nav and home edits, fixture seed, `portal-requests.spec.ts`. As listed in the spec.

## Tests
One test file per module as the spec lists, a copy-scan test (money, dates, durations, "free", "guarantee", em dashes) over every client string in the tree, and an e2e spec that files each kind of request and checks the Approve button is not transparent.

## Verification checklist
- [x] prisma validate, tsc, vitest (portal, waits, api/portal, services, api/tasks), next build
- [x] migration applies on a scratch database with no drift
- [x] Playwright portal-requests.spec.ts against a scratch database
