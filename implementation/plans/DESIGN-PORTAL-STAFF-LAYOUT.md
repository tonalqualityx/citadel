# Feature: Designer Portal: tech access, sites list, full-height workspace

Branch `feat/design-portal-staff-layout` (worktree `/home/mike/.openclaw/workspace/citadel-design-portal-staff-layout-wt`), from origin/main `a6688537`.

## Overview

Mike, 2026-11-17: "Sabeen should have full access to the portal. I think we also need to clean it up a bit. I suspect the design page should show sites/projects that have open design tasks. Instead of her selecting an individual task to work on we should let her select by project/site and then just leave the tasks in the task tab. We also need a way to expand the preview. There should be no vertical scroll on the citadel page itself, but the preview obviously should. Then the section at the top of the page should be able to be hidden so we can get more of the preview on the page"

Three parts. No schema change, no new endpoint, no new dependency.

- **A. Tech access.** Sabeen's role is `tech`. A tech user gets the whole working surface of the portal.
- **B. Sites list.** `/design` lists one row per project and site with open work and one Open/Resume button. Tasks stay in the workspace Tasks tab.
- **C. Workspace layout.** `/design/s/:id` fills the viewport exactly. The page never scrolls; the preview frame scrolls. A toggle hides everything above the preview toolbar.

## Decisions

### A. What a `tech` user may do

| Area | Rule for `tech` |
|---|---|
| Shell | Normal Citadel shell (`DesignStaffShell`), "Design" link in Sidebar and MobileNav |
| Drawer | Every enabled site's open tasks, no project-assignment limit (as admin and pm) |
| Sessions | Opens sessions; reads and writes any session, and enters another person's live session (as admin) |
| Session list | All sessions (as admin) |
| Start new work | Allowed, no assignment limit (as admin) |
| Timer | Owns the timer in a session the tech opened (as designer and admin) |
| Publish | Only when designer publish is on for the site: the same switch a designer is under. No ownership or on-project test. Off: `designer_publish_off`, and the tech may request a publish |
| Rollback | The tech's own publish, while designer publish is on |
| Art direction sign | Allowed (designer or tech; an admin stays 403 `designer_only`) |
| Admin page, admin lists, settings, operator keys, requeue | Not allowed (admin, and pm where pm reads today) |
| Re-open from a done review task | Not allowed (admin only, unchanged) |

Two helpers in `lib/design/access.ts` carry this so no call site spells the role list again:

```ts
/** Admin and tech: every enabled site, and read + write on any session. */
export function reachesAllSessions(role: string): boolean { return role === 'admin' || role === 'tech'; }
/** Roles that may open a session or start new work. */
export function opensSessions(role: string): boolean { return role === 'designer' || role === 'admin' || role === 'tech'; }
```

`DesignPublish.actor_role` stays `'designer'` for a tech publish and a tech rollback, and `PublishActorRole` is unchanged. Reason: the design daemon re-checks every publish (`~/.claude/tools/designer-portal/src/publish.ts` `actorRecheck`) and refuses any role other than `admin` or `designer` ("unknown actor role"); for `designer` it re-checks the designer publish switch, which is exactly the rule a tech is under. `approvalSourceFor` therefore keeps `design_publish:` for a tech, and the receipt regex is untouched. `actor_id` still names the tech user.

### B. Sites list

`projectDrawer` adds to each project group (the group is already project + site):

```ts
open_tasks: number;               // tasks in the group
track_stage: string | null;       // the stage of the group's track (first non-null task.track_stage)
entry: {
  action: 'resume' | 'start' | 'none';
  session_id: string | null;      // resume: go straight to /design/s/:id
  task_id: string | null;         // start: POST /api/design/sessions {task_id}
  reason: 'unavailable' | 'read_only' | 'taken' | null;   // only when action = 'none'
  chip: SessionChip | null;       // the resumed session's chip
};
```

`groupEntry` (pure, exported, in `projections.ts`), in this order:

1. **Resume.** Among the group's tasks, sessions with `mine === true` that are live (status not `closed`/`abandoned`), de-duplicated by session id. Prefer one on a task with `track_stage != null`; otherwise the newest by `created_at`. A pm also gets `resume` here (it reads the session).
2. Site not available: `none` / `unavailable`.
3. Role cannot open sessions (pm): `none` / `read_only`.
4. **Start on the track.** The first task with `track_stage` not null and not `done`/`cancelled`, unless that task shows a live session that is not mine (`none` / `taken`).
5. **Start on a task.** The first task in display order (phase order, then task order) with no live session held by someone else.
6. Otherwise `none` / `taken`.

`drawerSession` needs `created_at` passed through internally for step 1; it is NOT added to the response.

Page: `WorkerBanner`, then section "Sites" (`SiteWorkList`), then `StartWork`, then "My sessions". `TaskDrawer.tsx` and its test are removed.

Row content: site name (heading), project name, "N open quests" (static terms), the stage label when tracked (reuse the label map `StageStrip` uses), the session chip when resuming, and one `Button`:

| entry | Button |
|---|---|
| resume | "Resume" (pm: "View") |
| start | "Open" |
| none / unavailable | disabled "Not available yet" |
| none / taken | disabled "In use" |
| none / read_only | no button, text "No session yet" |

### C. Workspace layout

- New `components/domain/design/workspace-chrome.ts`: `TOP_KEY = 'citadel-design-workspace-top'` (`'hidden' | 'shown'`), a module-level store with `useTopHidden(): [boolean, (next: boolean) => void]` (`useSyncExternalStore`, server snapshot `false`, storage read in an effect on first subscribe, try/catch around storage). Moves `isWorkspaceRoute` here; `DesignStaffShell` re-exports it.
- `DesignStaffShell` on the workspace route: outer `h-dvh overflow-hidden`; content column `flex h-dvh min-h-0 flex-col`; `Header` wrapped in a div that takes `hidden` when the top is hidden; `main` is `flex min-h-0 flex-1 flex-col p-3`; the sidebar toggle row is hidden and the sidebar collapsed while the top is hidden (the saved sidebar choice is untouched). Other `/design` routes are unchanged.
- New client `DesignerShell.tsx` (DesignChrome + main) with the same workspace-route behaviour; `app/(design)/layout.tsx` renders it for a designer.
- `Workspace`: root `flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2`; `<header hidden={topHidden}>`; stage `relative min-h-0 min-w-0 flex-1` (no `h-[calc(100dvh-11rem)]`, no `min-h-[560px]`); passes a toggle button (`data-testid="top-toggle"`, `aria-pressed`, label "Hide top bar" / "Show top bar") to `PreviewPane` as `toolbarEnd`.
- `PreviewPane`: new `toolbarEnd?: React.ReactNode`, rendered at the end of the toolbar row, and in the top-right corner of the "Setting up your preview" state so the top can always be shown again. Frame area `min-h-0` instead of `min-h-[320px]`.
- `ChatDock`: the desktop panel never exceeds the stage: `min-[1100px]:max-h-[calc(100%-2rem)]`, min height `min(420px, calc(100% - 2rem))`.

## Impact analysis (2026-11-17, two read-only passes)

- Every `/api/design/sessions/**` route goes through `loadSessionFor` or `loadTrackedSession`; the track routes hold no role checks, so `sessionAccess` carries them.
- The design daemon refuses a publish whose `actor_role` is not `admin` or `designer`, so a tech publish is stamped `designer` (see Decisions A).
- The worker and runner service users have role `tech` but always come in on a lane API key; `authActor` refuses every key except an admin operator key, and `actsAsSignedIn` runs before any role branch. No tech rule may be reachable by an API key.
- `app/(design)/__tests__/layout.test.tsx` bans staff providers and `layout/Header` from `layout.tsx`, `DesignChrome.tsx` and `design/page.tsx`; `DesignerShell.tsx` joins that list.
- `Header` takes no pass-through props: wrap it in a div with `hidden` (stays mounted, so console capture and modals keep working).
- Other `/design` pages rely on the current `main` padding: the layout change is limited to the workspace route.
- Floors that would overflow a short stage: `Workspace.tsx` stage `min-h-[560px]`, `PreviewPane.tsx` 147/194/215, `ChatDock.tsx` `min-h-[420px]`, `ChatPanel.tsx:75` `min-h-[24rem]`.
- `findForbiddenKeys` scans the drawer response: `entry` holds ids, an action, a reason and a chip only.
- Six Playwright specs open a task through `fixtures/design-helpers.ts` `openTask()` (row by task title, button Start|Resume).

## Work packages and file ownership

**A. Tech access (server + nav).** `lib/design/access.ts`, `sessions.ts`, `work.ts`, `timer.ts`, `publish-policy.ts`, `publishes.ts`, `projections.ts` (the `mine` line only), `app/api/design/sessions/route.ts`, `.../feed/route.ts`, `.../art-direction/sign/route.ts`, `components/layout/Sidebar.tsx`, `MobileNav.tsx`, `lib/api/registry/design.ts` (role lists and role prose only), `prisma/schema.prisma` comment only if touched at all (no: leave it), and their tests.

**C. Workspace layout.** `components/domain/design/Workspace.tsx`, `PreviewPane.tsx`, `ChatDock.tsx`, `ChatPanel.tsx`, `DesignStaffShell.tsx`, new `DesignerShell.tsx`, new `workspace-chrome.ts`, `app/(design)/layout.tsx` (including the two-line tech admission), `app/(design)/design/s/[id]/page.tsx`, and their tests (`workspace.test.tsx`, `staff-shell.test.tsx`, `chat-dock.test.tsx`, new `designer-shell.test.tsx`, `app/(design)/__tests__/layout.test.tsx`).

**B. Sites list (after A and C).** `lib/design/projections.ts` (`groupEntry`, `projectDrawer`), `lib/hooks/use-design.ts` types, `app/(design)/design/page.tsx`, new `SiteWorkList.tsx`, delete `TaskDrawer.tsx`, `lib/api/registry/design.ts` (the `/api/design/tasks` entry), tests, and the Playwright helper, specs and fixture (tech user).

## Tests to Update (from Impact Analysis)

- [ ] `lib/design/__tests__/access.test.ts`: 152 tech drawer decision listed; 287 tech loads the drawer with no assignment lookup; 307-308 tech read/write `ok`; 359 tech reads and writes any session; 371 `mySessionsWhere` `{}`; 379 `publishPageAccess` `ok`; add `canReadAdminLists('tech')` false
- [ ] `lib/design/__tests__/publish-policy.test.ts`: 133 tech publishes under the designer switch (ok with `actor_role: 'designer'`, `designer_publish_off` when off, no ownership or on-project need); 136 lane key still `session_required`; D5 table row for tech; `canRequestPublish` tech ok when off / 409 `publish_allowed` when on; 417 and 448 `canRollback` tech own publish ok with the switch on, 403 `designer_publish_off` when off, another actor's publish 404
- [ ] `lib/design/__tests__/timer.test.ts`: tech opener owns the timer; another tech does not
- [ ] `lib/design/__tests__/projections.test.ts`: tech `mine`; 107 key list gains `entry`, `open_tasks`, `track_stage`; `groupEntry` cases
- [ ] `app/(design)/__tests__/layout.test.tsx`: tech renders the staff shell (redirect test removed); designer renders `DesignerShell`; banned-imports list gains `DesignerShell.tsx`
- [ ] `app/api/design/tasks/__tests__/route.test.ts`: 60 tech reads; `entry` and `open_tasks` present
- [ ] `app/api/design/sessions/__tests__/route.test.ts`: tech lists with `where: {}`; tech creates
- [ ] `app/api/design/sessions/[id]/publish/__tests__/route.test.ts`: 157 tech publishes on another person's session when the switch is on
- [ ] `app/api/design/publishes/[id]/__tests__/route.test.ts`: 62 tech 200
- [ ] `app/api/design/publishes/[id]/rollback/__tests__/route.test.ts`: 61 keep (not the tech's publish) and add the tech's own publish 202; 113 rewritten
- [ ] `app/api/design/sessions/[id]/request-publish/__tests__/route.test.ts`, `.../feed/__tests__/route.test.ts`, `.../site-tasks/__tests__/route.test.ts`: tech cases
- [ ] `components/layout/__tests__/MobileNav.test.tsx`: 110 tech sees Design; a user with no flag does not
- [ ] `components/domain/design/__tests__/design-drawer.test.tsx`: TaskDrawer cases removed (WorkerBanner and SessionList cases kept)
- [ ] `components/domain/design/__tests__/workspace.test.tsx`, `staff-shell.test.tsx`, `chat-dock.test.tsx`: storage cleared per test; existing class assertions kept
- [ ] `__tests__/e2e/fixtures/design-helpers.ts` `openTask` and the specs that read the home list (`design-portal.spec.ts` 39, 53, 65)

## Tests to Write

- [ ] `lib/design/__tests__/work.test.ts`: tech `loadStartSites` / `startWork` with no assignment lookup
- [ ] `lib/design/__tests__/sessions.integration.test.ts` + `fixtures.ts` tech user: tech creates a session; tech enters another user's live session (no `session_owned`)
- [ ] `app/api/design/sessions/[id]/art-direction/sign/__tests__/route.test.ts`: designer 200, tech 200, admin 403 `designer_only`
- [ ] `components/layout/__tests__/Sidebar.test.tsx`: tech sees Design and not Projects
- [ ] `components/domain/design/__tests__/site-work-list.test.tsx`: rows, buttons per entry, empty state, click handlers
- [ ] `components/domain/design/__tests__/designer-shell.test.tsx`, `workspace-chrome.test.ts`: top hidden state, persistence
- [ ] `staff-shell.test.tsx`: top hidden hides Header wrapper and toggle, collapses the sidebar, only on the workspace route
- [ ] `workspace.test.tsx`: `top-toggle`, header `hidden`, `toolbarEnd` slot
- [ ] Playwright: tech lands on `/design` in the staff shell and opens a site; workspace does not scroll at three viewports; hide-top persists across reload

## Files to Create
- [ ] `app/components/domain/design/SiteWorkList.tsx`
- [ ] `app/components/domain/design/workspace-chrome.ts`
- [ ] `app/components/domain/design/DesignerShell.tsx`
- [ ] tests listed below

## Files to Modify
See "Work packages and file ownership" above.

## Verification Checklist
- [ ] `tsc --noEmit` exit 0
- [ ] vitest: no failed file outside the baseline allowlist; every design test green
- [ ] lint: no touched file above baseline
- [ ] `next build` exit 0
- [ ] Browser check: at 1440x900, 1280x720 and 390x844 the workspace document does not scroll (`scrollHeight <= innerHeight`), the preview frame wrapper grows when the top is hidden, and the choice survives a reload
- [ ] Opus review of the access diff
