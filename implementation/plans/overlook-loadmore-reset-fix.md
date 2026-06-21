# Feature: Fix Overlook "load more" reset on mutation

## Overview
On the Overlook (dashboard), the Focus / Awaiting Review / Unassigned / My Tasks lists
support "load more" pagination. After loading more, any mutation (approve a task, or
toggle a task's focus) collapses the list back to the first 10 items.

## Root cause
`useLoadMoreDashboard` appends extra pages into the React Query cache via `setQueryData`
on the key `['dashboard', { orderBy, tz }]`. The main `useDashboard` query always fetches
only the first page (10 per list). When `useToggleFocus` / `useUpdateTask` invalidate
`['dashboard']` (and on the 30s `refetchInterval`), the query refetches the first page and
overwrites the appended items — so the loaded-more rows disappear.

## Fix
Make per-list loaded counts part of the dashboard query itself, so any refetch returns the
full loaded set. The client tracks how many items are loaded per list and passes those as
`limit_<list>` query params; "load more" just increases the count → the query refetches with
a larger page. This is robust against both mutation invalidation and the 30s refetch.

## Files to Modify
- [ ] `app/lib/hooks/use-dashboard.ts` — `useDashboard` owns per-list loaded counts +
      returns `loadMore(list, currentCount)` and `isLoadingMore(list)`; include counts in
      the query key + query string. Remove the now-obsolete `useLoadMoreDashboard`.
- [ ] `app/app/api/dashboard/route.ts` — accept `limit_<list>` query params (default 10,
      clamped to a max) and use them as the per-list `take`.
- [ ] `app/app/(app)/dashboard/page.tsx` — pass `loadMore` / `isLoadingMore` from
      `useDashboard` down to the overlook components.
- [ ] `app/components/domain/dashboard/pm-overlook.tsx` — consume `loadMore`/`isLoadingMore`
      via props instead of `useLoadMoreDashboard`.
- [ ] `app/components/domain/dashboard/tech-overlook.tsx` — same.
- [ ] `app/components/domain/dashboard/admin-overlook.tsx` — same.
- [ ] `app/lib/api/registry/dashboard.ts` — document the new `limit_<list>` query params;
      remove the now-unused (and already stale) `/api/dashboard/load-more` entry.

## Files to Delete
- [ ] `app/app/api/dashboard/load-more/route.ts` — replaced by `limit_<list>` on `/dashboard`;
      no remaining callers.

## Tests to Update (from Impact Analysis)
- `app/lib/hooks/__tests__/use-dashboard.test.ts` — type-only tests for the exported
  interfaces/type guards; all preserved, no changes expected.
- `app/lib/api/registry/__tests__/registry.test.ts` — generic registry shape tests; verify
  still green after editing the dashboard registry.

## Tests to Write
- [ ] `app/lib/hooks/__tests__/use-dashboard-loadmore.test.ts` — unit test for the pure
      helper that builds `limit_<list>` query params from loaded counts.

## Verification Checklist
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] Full test suite passes (`npm run test:run`)
- [ ] Production build succeeds (`npm run build`)
- [ ] One reversible commit; pushed to main (site auto_deploy = true)
