# Feature: @-mention users in task comments

## Overview
Let users tag other users in task comments by typing `@` then the user's name. An
autocomplete list of matching users appears; selecting one (click or Enter) inserts the
mention. Each mentioned user receives a `task_mentioned` notification. Mentions are persisted
on the comment and highlighted when the comment is rendered.

Task: Citadel 629bb001 (site Citadel, auto_deploy=true → push to main).

## Files to Create
- [x] `app/lib/utils/mentions.ts` — pure helpers: `getActiveMentionQuery(text, caret)`,
      `findMentionedUserIds(content, users)`, `escapeRegExp`, `renderMentionSegments`.
- [x] `app/lib/utils/__tests__/mentions.test.ts` — unit tests for the helpers.
- [x] `app/components/ui/mention-input.tsx` — controlled text input with `@` autocomplete dropdown
      (keyboard nav, click select), reports selected mentions.
- [x] `app/app/api/tasks/[id]/comments/__tests__/route.test.ts` — API tests for POST (mentions →
      notifications, dedupe, author-exclusion).
- [x] `app/prisma/migrations/20260621170000_comment_mentions/migration.sql` — add column.

## Files to Modify
- [x] `app/prisma/schema.prisma` — add `mentioned_user_ids String[] @db.Uuid` to `Comment`.
- [x] `app/app/api/tasks/[id]/comments/route.ts` — accept `mentioned_user_ids`, persist, validate
      against real active users, emit `task_mentioned` notifications, avoid double-notifying assignee.
- [x] `app/lib/hooks/use-comments.ts` — `mentioned_user_ids` on `Comment` + `CreateCommentInput`.
- [x] `app/components/domain/tasks/comment-section.tsx` — use `MentionInput`, track selected
      mentions, send ids on submit, highlight mentions in rendered comments.
- [x] `app/lib/api/registry/tasks.ts` — document `mentioned_user_ids` in body + response.

## Implementation Steps
1. Schema + migration (additive, reversible — no data change).
2. Pure mention utils + tests.
3. API route: schema, persist, validate, notify.
4. MentionInput component.
5. Wire comment-section (input + render highlight) + hook types.
6. Registry update.
7. Gates: tsc, vitest, build.

## Tests to Update (from Impact Analysis)
- No existing comment API tests exist. Existing `tasks/__tests__/route.test.ts` and
  `notification-dispatcher.test.ts` are unaffected (additive optional field).

## Tests to Write
- [x] `getActiveMentionQuery` detects `@query` at caret, ignores closed/space-separated tokens.
- [x] `findMentionedUserIds` maps `@Name` occurrences → ids, longest-name-first, dedupe.
- [x] POST comment with `mentioned_user_ids` emits one `task_mentioned` per valid mentioned user.
- [x] Author is never notified for self-mention; assignee not double-notified.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` green
- [ ] `npm run build` succeeds
