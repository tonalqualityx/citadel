# Feature: Questions we send a client are logged, and block the cards waiting on them

Task: https://citadel.becomeindelible.com/tasks/df97ee84-a8c2-45b1-a6da-0c0d019d1686
Project: Client email to project loop (afc803d5). Mike's yes: 2026-11-19 ("let's give Dox the power he needs to make this happen";
"I'm unlikely to log questions myself, so can we automate that and attach the questions to the appropriate project or task as needed?";
on blocking: "I mean that in the way that dependencies block tasks"). Internal work, ships on one yes (handbook section 4).

## Overview
1. Citadel: a card question can be a question we sent a client (who it was for, which email carried it), and it can block cards
   exactly as a task dependency does. An open question holds its cards in `blocked`; an answer, a withdrawal or (for a
   go-ahead-if-nobody-answers question) its date passing releases them. The unblock sweep counts an open question as an
   unfinished blocker.
2. Machine side: `~/.claude/tools/inbound/sent_questions.py` reads sent mail in mike@becomeindelible.com,
   mike@whoismikedion.com and bast@becomeindelible.com, spots questions sent to a contact of a client with a live project,
   logs each on the task it serves (else the project's own card) with the cards waiting on it, and after three business days
   open drafts a short nudge in Mike's account.
3. Backfill: Mike's Nov 13 "Copy differences" question to Kue Chang goes on the ThermalNetics copy card, replacing the
   stand-in card "Send Kue the copy ask and settle the booth pages".

## Schema (one additive migration, no drop)
TaskQuestion gains: `asked_of_contact_id` (ClientContact, set null on delete), `sent_account`, `sent_message_id`,
`sent_thread_id`, `sent_at`, `default_at`, `nudge_drafted_at`; implicit many-to-many `blocks` <-> Task
`blocked_by_questions` (`_QuestionBlocks`).

## API
- POST /api/tasks/:id/questions: optional `asked_of_contact_id`, `sent {account, message_id, thread_id?, at}`, `default_at`
  (go_with_recommendation only), `blocks` (task ids in the same project, or the card itself).
- POST / DELETE /api/tasks/:id/questions/:qid/blocks `{ task_ids }`.
- PATCH /api/tasks/:id/questions/:qid `{ nudge_drafted: true }` stamps `nudge_drafted_at`.
- GET /api/questions?state=open&for=client|mike|all&project_id=: questions across cards (never a Triage card), with the
  card, the contact, the email and the cards blocked.
- GET /api/tasks/:id: `blocked_by_questions`. Each question returns `blocks`.
- POST /api/tasks/unblock-sweep: first defaults every open go-ahead question whose `default_at` has passed (reason
  comment on each released card), then heals.
- Bast worker lane gains: ask a question, its blocks, the PATCH, GET /api/questions. It still never answers.

## Files to modify
- prisma/schema.prisma, new migration
- lib/services/dependencies.ts (one predicate: task blockers satisfied AND no open question)
- lib/tasks/questions.ts, lib/tasks/question-context.ts, question routes, new blocks route, new /api/questions route
- app/api/tasks/[id]/route.ts + lib/api/formatters.ts (blocked_by_questions)
- components/domain/tasks/task-dependencies.tsx, task page (questions in the Blocked by list)
- lib/auth/lane-scopes.ts, lib/api/registry/tasks.ts

## Tests
- dependencies.test (mocked): predicate with open/answered questions
- integration (scratch Postgres): ask with blocks -> card blocked; heal leaves it; answer -> released; withdraw -> released;
  default_at passed -> defaulted + released + reason comment; cross-project block refused; GET /api/questions
- sent_questions.py: unit tests with fake transports (no network)

## Verification
tsc, full vitest (scratch DB for integration), next build, lint delta on changed files, deploy, live check through the API.
