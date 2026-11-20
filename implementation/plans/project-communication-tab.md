# Feature: Project Communication tab

Citadel task 379bb500 (project "Client email to project loop"). Mike, 2026-11-19: "I'd love to potentially see a record of all communication related to a project on a tab on the project screen. We might actually already have some of that. It could also link to meetings where project items were discussed."

## Overview
A pm/admin-only Communication tab on the project screen: one newest-first timeline of the project's emails, logged questions and meetings, each linked to where it lives.

## Sources
- Emails: `email_asks` with `project_id` = the project, or `task_id` on one of its cards. mike@ and bast@ copies of one message (same RFC Message-ID) show once. Link: the Gmail thread (normalizeGmailDeepLink).
- Questions: `task_questions` on the project's cards, not withdrawn, not on a Triage card (same rule as GET /api/questions). Dated by `sent_at`, else `created_at`. Link: the card.
- Meetings: linked through `meeting_projects`, or the meeting a project card came from (`tasks.meeting_id`); not deleted. Link: `/meetings/<id>`.

## Files
- [x] `lib/projects/communication.ts`: pure `buildCommunicationTimeline` + `loadProjectCommunication`
- [x] `app/api/projects/[id]/communication/route.ts`: GET, pm/admin
- [x] `lib/hooks/use-project-communication.ts`, `projectKeys.communication`
- [x] `components/domain/projects/project-communication-tab.tsx`: list with kind filter
- [x] `app/(app)/projects/[id]/page.tsx`: tab shown to pm/admin
- [x] `lib/api/registry/projects.ts`: registry entry

## Impact
Additive only: a new route, hook, query key and component; the page gains one tab. No existing signature or response shape changes, so no existing test needs updating.

## Tests
- [x] `lib/projects/__tests__/communication.test.ts` (merge, order, dedupe, links)
- [x] `app/api/projects/[id]/communication/__tests__/route.test.ts` (filters, auth, 404)
- [x] `lib/projects/__tests__/communication.integration.test.ts` (real scratch DB: inclusion and exclusion rules)
- [x] `components/domain/projects/__tests__/project-communication-tab.test.tsx` (links, filter, empty state)
