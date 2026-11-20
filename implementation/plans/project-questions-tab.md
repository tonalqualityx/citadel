# Feature: Project Questions tab

Citadel task c0d4ca5d (project "Client email to project loop"). Mike, 2026-11-19: "I'd also like to make sure I can see all open questions attached to a project on the project screen, with the ability to answer any of them right there."

## Overview
A pm/admin Questions tab on the project screen lists every open question on the project's cards, oldest first, each answerable in place with the card screen's own answer form. The header shows the open count and opens the tab.

## Design
- Read: `GET /api/questions?state=open&for=all&project_id=&limit=500&include_triage=1`. The response gains `asked_by: { id, name } | null` (names read in one query). `include_triage` adds questions on the project's Triage cards, honoured only for Mike's session or the chat lane (the same people who read and answer them on the card); anyone else gets the old list.
- Answer: `POST /api/tasks/:task_id/questions/:qid/answer`, the route the card screen uses; it already releases the cards the question blocks. The toast says how many cards it let go.
- Each row: who it is for (client contact or Mike), who asked (name, else the agent lane), date asked, its card, the cards it holds.
- Only Mike answers (same `user.id === MIKE_USER_ID` check as the card screen; the server enforces it).
- Tabs became controlled so the header count can open the Questions tab.

## Files
- [x] `lib/tasks/questions.ts`: `asked_by` and `include_triage` in `listAllQuestions`
- [x] `app/api/questions/route.ts`: `include_triage` query param
- [x] `lib/hooks/use-project-questions.ts`: read and answer hooks
- [x] `lib/hooks/use-task-questions.ts`: a card-screen answer also refreshes project question lists
- [x] `components/domain/projects/project-questions-tab.tsx`
- [x] `components/domain/tasks/questions/question-copy.ts`: `askedDate` (with the year)
- [x] `app/(app)/projects/[id]/page.tsx`: header count, Questions tab
- [x] `lib/api/query-keys.ts`, `lib/api/registry/tasks.ts`

## Tests
- [x] `components/domain/projects/__tests__/project-questions-tab.test.tsx`
- [x] `app/(app)/projects/[id]/__tests__/page.test.tsx`: mocks for the new hook; header count opens the tab
- [x] `lib/tasks/__tests__/client-questions-block.integration.test.ts`: `asked_by`, the project list, Triage-card questions for Mike only
