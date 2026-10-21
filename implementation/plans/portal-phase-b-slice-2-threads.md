# Feature: Portal phase B slice 2, threads, notifications, retainer and projects

Spec: `/home/mike/Documents/indelible-ops/specs/client-portal-phase-B-SPEC.md` section 7, slice 2.
Branch `portal/b2-threads`, cut from `portal/b1-requests`; slice 1 fix commits arrive by `git merge main`.

## Overview
The conversation on a request (client messages, staff replies shared as "Indelible"), the email
outbox behind staff replies, the Retainer and Projects pages, and the machine-side changes that
keep the worker's comments internal unless marked.

## Schema (one additive migration, 20261021180000_portal_b_threads)
Comment.client_visible, author_contact_id, client_ref (unique); Charter.client_label;
PortalNotice (+ enum); ClientReport. Nothing renamed, dropped or made required.

## Files
- `lib/portal/thread.ts` (visibility rule, loadThread, postClientMessage, Bast-word check), `linkify.ts`
- `lib/portal/notices.ts` (recipients, queue/absorb, body, cancel stale), `share-reply.ts` (gates and effects)
- `lib/portal/waits.ts` (+ onClientMessage, onStaffReply); `lib/waits/templates.ts` (+ portal.client_reply, portal.awaiting_client); `portal-precondition.ts` (staff reply closes the clock)
- `lib/portal/retainer.ts`, `projects-list.ts`; `history.ts` (engagement per item); `engagement.ts` (retainer href)
- Routes: `api/portal/work/[id]/messages`, `portal/retainer`, `portal/projects`, `portal/home` (+retainers, summary), `tasks/[id]/comments` and `comments/[id]` (client_visible), `portal-notices/**`, `client-reports`
- UI: `components/portal/thread.tsx`, retainer and projects pages, nav, book `?type=`, comment-section composer (Reply to client / Internal note)
- Machine: `approval-sender.py.next` (process_portal_notices), `spawn-gate.py`, citadel-worker `SKILL.md` (backups `.bak-20261021`)

## Tests
Vitest per module (thread, notices, retainer, projects-list, waits-thread, share-reply, copy scan,
route tests, comment-section component), python unittest for the sender and gate,
`__tests__/e2e/portal-threads.spec.ts` on the scratch database.

## Verification checklist
- [ ] prisma validate, tsc, the slice vitest set, next build, Playwright on the scratch DB: all exit 0
- [ ] approval-sender and spawn-gate unit tests, `DRY_RUN=1 approval-sender.sh` exit 0
