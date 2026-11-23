# Feature: Project questions

Approved by Mike on 2026-11-23 ("Yes, build that feature"). Built the same day.

## Overview
A question can be asked on the project itself, with no card. Mike, 2026-11-23: "Sometimes the answer will determine what tasks get
created, so we have a chicken and egg problem". A card question needs a card; some questions come before any card can exist.

A project question is a `task_questions` row with `project_id` set and `task_id` null. It carries the same Context parts as a card
question and reads back in the same shape. It always waits for its answer, blocks no cards, and is never sent to a client.

## Files created
- [x] `app/prisma/migrations/20261127090000_project_questions/migration.sql`: `task_id` nullable, `project_id` added, check that exactly one is set
- [x] `app/lib/projects/project-questions.ts`: list, ask, change or withdraw, answer
- [x] `app/app/api/projects/[id]/questions/route.ts`: GET, POST
- [x] `app/app/api/projects/[id]/questions/[qid]/route.ts`: PATCH
- [x] `app/app/api/projects/[id]/questions/[qid]/answer/route.ts`: POST
- [x] `app/components/domain/projects/project-question-form.tsx`: the "Ask a question" form
- [x] `app/lib/projects/__tests__/project-questions.integration.test.ts`

## Files modified
- [x] `app/prisma/schema.prisma`: TaskQuestion and the Project relation
- [x] `app/lib/tasks/questions.ts`: nullable `task_id`, `project_id` and `project` on the list, project-scope cause dedupe finds a project question
- [x] `app/lib/tasks/question-context.ts`, `app/lib/tasks/triage-card.ts`: nullable `task_id`
- [x] `app/lib/engagement/snapshot.ts`: open project questions in `questions`, and `project_questions` with answers (how Dox reads one)
- [x] `app/lib/projects/communication.ts`: project questions on the Communication timeline
- [x] `app/lib/dox/guard.ts`: `guardDoxProjectQuestion` (a live project only)
- [x] `app/lib/auth/lane-scopes.ts`: the four routes for the chat lane and the Dox lane
- [x] `app/lib/api/registry/projects.ts`, `tasks.ts`: the new endpoints and the changed list shape
- [x] `app/lib/hooks/use-project-questions.ts`, `app/components/domain/projects/project-questions-tab.tsx`, `app/app/(app)/projects/[id]/page.tsx`

## Tests updated (from impact analysis)
- [x] `app/lib/auth/__tests__/lane-bast-chat.test.ts`, `lane-dox.test.ts`: the pinned lane lists gain the four routes
- [x] `app/app/api/projects/[id]/communication/__tests__/route.test.ts`: the question query now also reads the project's own
- [x] `app/components/domain/projects/__tests__/project-questions-tab.test.tsx`: a project question row, answering it, the ask form

## Not in this build
- A project question does not block cards, carry a go-ahead date, or go to a client. Those stay with card questions.
- The worker lane (`bast`) does not reach the project question routes.
- Dox's gap check still holds a finding that has no card (`held_no_card`) instead of raising it on the project.

## Verification
- [x] TypeScript compiles
- [x] Lint clean on changed files
- [x] New and existing tests pass against a scratch Postgres
- [x] Migration applies to a scratch database and the schema matches it with no drift
