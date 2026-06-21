# Feature: Wire @-mention notifications to article comments + comment edits

Citadel task `32760677-b879-4c3b-b562-e63fc231e4c0`.

## Overview
Mention notifications currently fire only on TASK comment **creation**
(`app/api/tasks/[id]/comments` POST). Extend the same `task_mentioned` notification wiring to two
surfaces that lack it:
1. **Troubador article comments** — `app/api/troubador/articles/[id]/comments` POST.
2. **Comment edits** — `app/api/comments/[id]` PATCH (task comments) so adding an `@` on edit also
   notifies the newly-mentioned user.

## Design decisions
- **Server-side mention parsing.** Both the article-comment hook (`use-troubador.ts`) and the
  comment-edit flow (`comment-section.tsx`) send only `{ content }` — they do NOT send
  `mentioned_user_ids`. So we parse mentions on the server with the existing
  `findMentionedUserIds(content, activeUsers)` helper (the same pure helper the client uses), against
  the active-user list. This is robust regardless of payload and reuses shared logic.
- **Reuse the `task_mentioned` notification type** (no enum/schema migration). For articles we set
  `entityType: 'article'` + `entityId: <articleId>`; for edits `entityType: 'task'`. Preferences are
  honored automatically (createNotification → dispatcher → getNotificationPreference). No DB migration
  → fully reversible.
- **Edit = notify only newly-added mentions.** `Comment.mentioned_user_ids` already stores the prior
  set. On a content edit we recompute the set, notify `new − old`, and persist the recomputed set so
  repeated edits don't re-notify. `is_internal`-only toggles (no content change) leave mentions
  untouched.
- Author is never self-notified (exclude `auth.userId`).

## Files to Modify
- [ ] `app/app/api/troubador/articles/[id]/comments/route.ts` — after creating the comment, parse
      mentions, notify mentioned active users (excl. author) with `task_mentioned`/`entityType:'article'`.
- [ ] `app/app/api/comments/[id]/route.ts` — on PATCH with content, include task.title +
      mentioned_user_ids, recompute mentions, notify newly-added, persist recomputed set.
- [ ] `app/components/domain/notifications/NotificationItem.tsx` — (optional) no article route exists
      on the team side; leave routing as-is (notification still shows, just no deep-link). Documented,
      not changed.

## Files to Create
- [ ] `app/app/api/troubador/articles/[id]/comments/__tests__/route.test.ts` — new test.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/comments/[id]/__tests__/route.test.ts` — the "content-only edit" assertion expects
      `data: { content: 'edited' }`; recompute now also writes `mentioned_user_ids`, so update the
      expectation and add prisma `user.findMany` to the mock + mock `createNotification`. Add cases:
      adding a mention on edit notifies the new user; editing without new mentions notifies nobody;
      `is_internal`-only toggle does not recompute/notify.

## Tests to Write
- [ ] Article comment with an @mention → `task_mentioned` notification for the mentioned active user.
- [ ] Article comment mentioning the author → no self-notification.
- [ ] Article comment with no mention → no notification; existing reopen-on-feedback behavior intact.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] Full vitest suite green (incl. new tests)
- [ ] `npm run build` succeeds
- [ ] One reversible commit; push to `main` (site auto_deploy=true); CI green
