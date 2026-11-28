# Feature: Slack notice sort (task 736ee760)

## Overview
Citadel's Slack direct messages follow the sender sort in the slack-notices-overlook project (work/proposal.md, Citadel section):
keep posts at once in four parts (what happened, why it matters, the one action, a link); digest folds into one DM per user at
9:00 New York; stop is logged only.

## Files to Create
- [x] `lib/services/slack-sort.ts` - pure sort, four-part builder, digest builder, 9:00 New York timing, wait digest title
- [x] `prisma/migrations/20261208100000_slack_notices/migration.sql` - additive `slack_notices` table (the sort log and digest queue)
- [x] `app/api/notifications/slack-notices/route.ts` - GET the sort log (pm/admin)

## Files to Modify
- [x] `lib/services/notification-dispatcher.ts` - route Slack by the sort; project batch queuing replaced by the digest
- [x] `lib/services/slack-notifications.ts` - kept sender in four parts, digest queue, stop log, `sendDueSlackDigests`
- [x] `lib/services/slack.ts` - return Slack's echoed text
- [x] `app/api/waits/sweep/route.ts` - the overdue wait nudge is a digest line; the sweep sends due digests
- [x] `lib/api/registry/waits.ts`, `lib/api/registry/users.ts` - response shapes and the new route

## Tests
- [x] `lib/services/__tests__/slack-sort.test.ts` - stop, digest, keep, the four parts, digest order and cap, DST timing, wait title
- [x] `lib/services/__tests__/slack-digest-send.test.ts` - once a day after 9:00, rows stamped
- [x] `lib/services/__tests__/notification-dispatcher.test.ts`, `app/api/waits/sweep/__tests__/*` - updated for the new routing

## Verification Checklist
- [x] TypeScript compiles
- [x] Unit tests pass (only the two DATABASE_URL baseline tests fail, as on main)
- [x] Migration applies clean to the scratch database
- [x] Production build
