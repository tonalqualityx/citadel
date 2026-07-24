# Feature: Notifications drawer "Clear all" button

## Overview
Add a "Clear all" action to the notifications drawer (NotificationBell) that
deletes all of the current user's notifications, clearing the drawer. This is
distinct from the existing "Mark all read" (which only flips is_read).

## Impact Analysis
- Codebase: The drawer UI lives only in `NotificationBell.tsx`. Notification
  mutations live in `lib/hooks/use-notifications.ts`. Server routes under
  `app/api/notifications/`. No other consumers of a "clear all" concept exist.
- Tests: No existing test asserts on clear-all. mark-all-read has no route test.
  New route gets its own test. No existing test breaks (purely additive).

## Files to Create
- [x] `app/api/notifications/clear-all/route.ts` - POST deletes all user notifications
- [x] `app/api/notifications/clear-all/__tests__/route.test.ts` - unit test

## Files to Modify
- [x] `lib/hooks/use-notifications.ts` - add `useClearAllNotifications`
- [x] `components/domain/notifications/NotificationBell.tsx` - add "Clear all" button
- [x] `lib/api/registry/users.ts` - register the endpoint

## Implementation Steps
1. Add `POST /api/notifications/clear-all` (deleteMany by user_id), mirror mark-all-read.
2. Add `useClearAllNotifications` hook, invalidate notificationKeys.all on success.
3. Add "Clear all" button in the drawer header, shown whenever notifications exist.
4. Register endpoint in the API registry.
5. Write route unit test; run type-check + full suite + build.

## Verification Checklist
- [ ] TypeScript compiles without errors
- [ ] New + existing tests pass
- [ ] Production build succeeds
