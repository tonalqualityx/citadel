# Feature: POST /api/tasks honors is_focus

## Overview
`POST /api/tasks` accepted an `is_focus` field in the request body and silently discarded it:
`createTaskSchema` never declared the field, and Zod's default object behaviour strips unknown
keys without error. Every task created by an API client that asked for focus was stored with
`is_focus: false`. Because `/api/waiting-on-me` builds its queue from five sweeps (is_focus,
overdue, done+needs_review, blocked, due within 14 days), a task with `is_focus: false` and no
`due_date` matches none of them and never appears in the feed at all.

Fix: declare `is_focus` on the create schema and write it through on create, mirroring the
PATCH route which has always supported it.

## Impact Analysis

### Codebase impact
- `createTaskSchema` is local to `app/api/tasks/route.ts`; nothing imports it. Adding an
  optional boolean is purely additive — existing callers that omit the field keep the Prisma
  column default (`false`).
- `formatTaskResponse` (`lib/api/formatters.ts:911`) already emits `is_focus`, so the create
  response needs no change.
- `PATCH /api/tasks/[id]` already accepts `is_focus` (`route.ts:48`, `:472`). No conflict.
- `/api/waiting-on-me`, `/api/focus-tasks`, `/api/dashboard` read `is_focus` from the column;
  no read-side change needed.

### Test impact
- `app/api/tasks/__tests__/route.test.ts` — every `mockTaskCreate` assertion uses
  `expect.objectContaining`, so an extra key in the create payload breaks nothing. The shared
  `mockCreatedTask` fixture already carries `is_focus: false`.
- No other test file asserts on the POST create payload shape.

## Files to Modify
- [ ] `app/app/api/tasks/route.ts` — add `is_focus` to `createTaskSchema`; write it in `prisma.task.create`
- [ ] `app/lib/api/registry/tasks.ts` — document `is_focus` on the POST body + response example
- [ ] `app/app/api/tasks/__tests__/route.test.ts` — tests for the new behaviour

## Implementation Steps
1. Add `is_focus: z.boolean().optional()` to `createTaskSchema`.
2. Pass `is_focus: data.is_focus ?? false` into the `prisma.task.create` data block.
3. Update the API registry entry (body param + response example).
4. Add tests.

## Tests to Update (from Impact Analysis)
- None. Existing assertions are `objectContaining` and are unaffected.

## Tests to Write
- [ ] `is_focus: true` in the body is written through to the create call
- [ ] `is_focus: false` in the body is written through
- [ ] omitting `is_focus` creates with `false` (no behaviour change for existing callers)
- [ ] a non-boolean `is_focus` is rejected with 400 rather than silently dropped

## Out of scope (reported, not built)
The task's second item — "consider whether a client-attached task with no due date should enter
the feed by default" — changes what `/api/waiting-on-me` returns for every user and would add
~83-123 tasks to the current feed at once. That is a product decision, not a bug fix, so it is
raised in the task comment rather than shipped here.

## Verification Checklist
- [ ] TypeScript compiles without errors
- [ ] Unit tests pass
- [ ] No regressions in existing tests
- [ ] Production build clean
