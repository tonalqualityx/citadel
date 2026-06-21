# Feature: @-mention tagging in task comments — intelligent client-scoped suggestions

Citadel task `640d0389` ([Loop] @-mention tagging in comments (intelligent, client-scoped) + notify-on-tag).

## Overview
Task comments already support @-mentions end-to-end: `Comment.mentioned_user_ids`, the
`MentionInput` composer, `lib/utils/mentions.ts`, and `task_mentioned` notifications all exist and
work. The remaining gap vs. the task's acceptance criteria is **suggestion scoping**: the composer
currently suggests *all* team members (`useUsers()`) and **no client contacts**. The task wants:

> suggestions = ALL Indelible team members PLUS only the client-contacts of THIS task's client
> (the "13 Nicoles → only the relevant Nicole" problem). Clients/contacts can be tagged; a client
> commenting from the portal can comment but cannot tag.

So the delta is: a task-scoped mention-suggestions source (team + only this task's client's
contacts), wire the composer to it, render contact mentions, keep team-user notify working.

## Scope decisions (deliberate, documented)
- **Contacts are selectable + rendered, team users are notified.** Acceptance says "mentioning a
  **user** creates a notification." Contacts (`ClientContact`) are not `User`s and have no in-app
  notification channel; auto-emailing a contact would cross the SOUL client-comms boundary
  (client email is draft-only except the staging "ready for review" note). So contacts appear in
  the autocomplete and render as highlighted mentions, but are **not** auto-notified. A future
  "email contact on tag" can be added behind Mike's approval. Noted in the task summary.
- **"Clients cannot tag" is already structurally enforced.** The comment POST route uses
  `requireAuth()` (team JWT / API key only); client-portal sessions use `requireClientAuth()` and
  cannot authenticate to it. No code change needed; add a clarifying comment.
- **Article comments are out of scope** — that's a separate task (`32760677`).
- **No schema/migration change** — `mentioned_user_ids` already exists; contact mentions need no
  new column for this scope.

## Files to Create
- [ ] `app/app/api/tasks/[id]/mention-suggestions/route.ts` — GET: team users + this task's
      client's contacts. Team-auth, mirrors the comments-GET tech-access guard.
- [ ] `app/app/api/tasks/[id]/mention-suggestions/__tests__/route.test.ts` — scoping tests.
- [ ] `app/lib/hooks/use-mention-suggestions.ts` — React Query hook.

## Files to Modify
- [ ] `app/components/domain/tasks/comment-section.tsx` — source candidates from the new hook;
      build team-only set (for `findMentionedUserIds`) and combined set (for `MentionInput`
      suggestions + `renderMentionSegments`).
- [ ] `app/lib/api/registry/tasks.ts` — register the new endpoint.
- [ ] `app/app/api/tasks/[id]/comments/route.ts` — one clarifying comment re client-cannot-tag.

## Implementation Steps
1. New GET route: load task (404 if missing); tech-access guard as in comments GET; fetch active
   users (`is_active`) and, if `task.client_id`, that client's non-deleted contacts. Return
   `{ users: [...], contacts: [...] }`. Contact display name falls back to email when name is null.
2. Hook `useMentionSuggestions(taskId)` → GET `/tasks/:id/mention-suggestions`.
3. Composer: `teamCandidates` (users, minus self) drives `findMentionedUserIds`; `allCandidates`
   (users + contacts, minus self) drives the `MentionInput` dropdown and `renderMentionSegments`.
4. Registry entry + clarifying comment.

## Tests to Update (from Impact Analysis)
- None break. Existing `comments` route tests, `mentions.test.ts`, `use-users` consumers unaffected
  (`useUsers` stays; only the composer's source changes).

## Tests to Write
- [ ] returns active team users + only this task's client's contacts
- [ ] task with no client_id → contacts empty, users still returned
- [ ] 404 when task not found
- [ ] query scopes contacts by `client_id = task.client_id` and `is_deleted: false`, users by `is_active`
- [ ] tech user without task access → 404 (guard)

## Verification Checklist (Custom Development SOP)
- [ ] tsc --noEmit clean
- [ ] full vitest suite passes incl. new tests
- [ ] production build succeeds
- [ ] one reversible commit; push to main (auto_deploy=true); CI green
