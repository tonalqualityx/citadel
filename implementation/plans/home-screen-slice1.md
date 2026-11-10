# Mike's home screen: build plan

Written 2026-11-10 (just after midnight UTC) from `design/home-screen.md`, `design/home-preview-template.html`, `design/tonight-preview.json`, `DECISIONS.md` (sections dated 2026-11-09 evening and later), `design/research.md`, the Citadel source on `main` at `5ee0571`, and GET reads of production Citadel. Nothing was built, no branch was made, nothing was written to Citadel.

Mike's ruling: "Build it" (2026-11-09 late night). Not covered by that ruling: pushing to `main`, which deploys to production. The slice stays on its branch until Mike says deploy (DECISIONS.md line 64).

Paths below are relative to the repo root `/home/mike/.openclaw/workspace/citadel`. The Next.js project root is `app/`, so the App Router lives in `app/app/` and shared code in `app/lib/`. When the design says `lib/home/`, it means `app/lib/home/`.

## 1. Slices

Each slice is useful alone, deploys alone, and adds only nullable or defaulted schema. Nothing in a later slice blocks Slice 1.

### Slice 1: the approved screen with real data (this plan's task list)

What Mike gets: he opens Citadel and lands on the wide screen from the approved preview, filled from live Citadel data, for his user only.

In:
- The per-user switch `UserPreference.home_view` (default `overlook`), read by `/dashboard`. Every other user sees the Overlook exactly as today.
- `GET /api/home`: builds every tile, list and card server-side from existing fields (section 1.3 below has the exact rules). It also writes the day's proposal once per day (`home_day`), the same once-a-day pattern `/api/today` already uses for rollover.
- Ranking from section 2A computed from existing fields only: emergency rules, consequence class, an importance score and an urgency score. No learning, no nightly job.
- Today from section 2C: up to 3 quick items, then one arc of up to 4 open steps, the size line, "Lighter today" and "Swap arc". Mike can add a step (from his in-view items, his open tasks, or a new one-line task), remove a step, and drag to reorder. His edits stick by the rules in 2C.4a.
- The count tiles in the preview's order: Today, need you now, things in progress, sales leads waiting, client emails waiting, decisions ready, projects, handled for you, everything else.
- The card in the section 2B shape: title, summary, "Done when" checklist, How (SOP link), Links, buttons, and the muted footer ("Why it's here", "If you do nothing").
- "Not now" (next business day 9:00, then a week, then only the real choices plus "Let it go") and "This matters more" (top of its section at once). Both are stored per item for his user only.
- "I'll do it now" pins one item in "things in progress", with "Switch to this one?" for a second pin and "Where did you leave it?" on "Stop for now". While an item is pinned, the other lists collapse to one line.
- Every action that already exists in Citadel, wired to its existing endpoint (table in section 1.4).
- "Handled for you": read-only lines for asks the email classifier closed on its own in the last 24 hours (it marks an ask handled when Mike's sent reply appears on the thread).
- "Everything else": one count sentence and the groups behind it.
- A one-visit escape hatch: `/dashboard?view=overlook` shows Mike the Overlook without changing his switch.

Out of Slice 1, and where each goes:
| Left out | Slice |
|---|---|
| Nightly keeper job, `view_at` staggering (3 a day), one-time backlog scoring (2A.6), card summaries written by Bast for long descriptions, stale-arc housekeeping, creating real `Arc` records for proposed groups | 2 |
| `Task.hard_due_at` and `hard_due_source`, `create-task.py` change (W2-06) | 2 |
| "Everything else" drawer with owner and check date per item, and "Bring it forward" | 2 |
| Handled lines for keeper actions, each with undo | 2 |
| Bell hidden, sidebar collapsed behind "Menu", bot "mentioned you" notices muted, a settings toggle for `home_view`, the "You were on this" prompt after 20 minutes away | 3 |
| Owed-reply keeper: Bast drafts into Gmail within the hour, "Send the draft" through `EmailOutbox` with the 10-minute hold (`EmailOutbox.send_after`), "Draft it now", needs-thought rows with Bast's read and a suggested answer, "Go with that", "Book 30 minutes", lead clock and re-surfacing, cross-inbox thread joining, wake on new activity | 4 |
| Meeting lane (book, invite, calendar link, caps, first 3 bookings ask), "Send my calendar link" | 5 |
| Emergency lane: site-down second check, Slack line on first sight and after 4 working hours, "Not an emergency" saved as a rule in the `Decision` store, automatic outside scan, hand to Sabeen after 1 business day, lifeline daily Slack line, the Monday "This week's hands" row | 6 |
| Learning: `home_score_weights`, bounded weight shifts from "Not now", "This matters more" and arc edits, the Monday "Learned:" line; energy, unknowns and drain guesses from `TimeEntry` history; scout pass for unknowns; the section 7 measures and the approval-speed guard | 7 |
| Project drawer content from r5 (status sentence, waiting on whom since when, his items in that project), project next steps as Next rows | 8 |
| Bast chat panel (approved "Yes", but waits on the Claude sign-in pass-through ruling) | 9 |

Recommended order after Slice 1: 2, 4, 6, 3, 7, 5 (needs Mike's three meeting choices), 8, 9.

What Slice 1 is honest about: no row may promise a step the system does not yet take. The preview's "If you do nothing" lines (Bast scans tonight, Slack line Wednesday, goes to Sabeen at 9 am) describe Slices 4 to 6. Slice 1 lines say what really happens, for example "Stays here. Nothing happens on its own." or, for a wait, its own clock and terminal action.

### 1.1 Item sources for Slice 1 (all existing data)

Every item has a stable key. The loader reads these, for the signed-in user U (Mike):
| Source | Key | Rule |
|---|---|---|
| Tasks | `task:<id>` | `assignee_id = U`, `is_deleted = false`, status not `done` or `abandoned`, and project is null or its status is not `quote`, `queue`, `suspended`, `cancelled` or `done` |
| Review sign-off | `review:<project_id or none>` | one item per project folding every task with `status = done`, `needs_review = true`, `approved = false`, `reviewer_id` U or null (same rule as `/api/waiting-on-me`) |
| Session asks | `session:<external_id>` | `OracleSession.waiting_on` not null, `archived_at` null, status not `ended` or `stale` |
| Waits | `wait:<id>` | state `waiting`, `needs_human` or `blocked_by_switch`, owner resolved to U by `loadWaitCandidates` (`app/lib/waits/load-blocks.ts`); in view when `needs_human` or `due_at` has passed |
| Email threads | `thread:<account>:<thread_id>` | open, non-urgent `EmailAsk` rows grouped by account and thread; rule in 1.3 |
| Crisis mail | `crisis:<email_ask id>` | open `EmailAsk` with `is_urgent = true`, sender not on the noise list |
| Projects | (tile only) | the existing `useOracleProjects()` hook and `ProjectDrawer`, no new server code |

### 1.2 What each tile holds

- Needs you now: items that meet an emergency rule (1.3). No cap. Order: client-facing first, then nearest hard date, then oldest.
- Things in progress: the one pinned item, if any.
- Sales leads waiting: thread items whose ask has `intent = sales`.
- Client emails waiting: the other thread items that qualify (1.3). Cap 3 visible, oldest first; a lead never counts against a cap.
- Decisions ready: the Next queue, 3 visible, refilled as he acts.
- Projects: the existing Oracle projects list; clicking opens `ProjectDrawer`.
- Handled for you: classifier auto-closes in the last 24 hours, newest first, 5 lines then "{n} more handled".
- Everything else: everything on his plate not shown above, as one sentence plus groups (waiting their turn, parked by you, on paused or unsigned projects, review pieces folded under a sign-off, older open threads, other ventures).

### 1.3 Ranking rules for Slice 1, from existing fields only

These live in `app/lib/home/rules.ts` and `app/lib/home/score.ts` as named constants, so a later slice can tune them without touching callers. No score, class, quadrant or P-number is ever sent to the browser or shown.

Never read: `Task.priority`, Mike's own `due_date` on a task with no `promised_to`, `is_focus`.

Hard date (Slice 1): a task's `due_date` counts as a hard date only when `promised_to` is set, or the task carries a tag starting `job-watch` or the tag `lifeline`. It renders as the filled chip "Due {weekday}, {month} {day}" plus "({promised to name})" when known. Every other date is ignored, and the row shows elapsed time.

Emergency rules (any one):
1. Task with a tag in {`security`, `security-report`} and a `site_id` or `client_id`.
2. Task with a tag `lifeline` or a tag starting `job-watch`.
3. Task with tag `client-blocking`.
4. Wait owned by U with `blocks_client = true` and `client_waiting_since` more than 1 business day ago.
5. Session ask with `ask_severity = client_blocking`.
6. Crisis mail (open, `is_urgent`), sender not on the noise list.
7. A hard date 2 business days away or less where `promised_to` is set.
An item Mike marked "Not an emergency" (stored per item in Slice 1) drops out of this tile and is ranked like any other item.

Noise list (`rules.ts`): sender domains `collectiveyouth.com`, `wol.org`; client names containing "Balloon Guild", "Cygal", "Word of Life". The Cygal, Word of Life and Balloon Guild sender domains are not verified, so Slice 1 matches them by client name only.

Own addresses (never a person waiting): `mike@becomeindelible.com`, `mike@whoismikedion.com`, `support@becomeindelible.com`, `bast@becomeindelible.com`, `hello@becomeindelible.com`. These come from memory notes and tonight's data; the list is a constant.

Thread qualifies for a People tile when all hold:
- the sender is not an own address, not on the noise list, and not automated (local part or domain matching `no-reply`, `noreply`, `notification`, `servers@`, `uptime`, `drive-shares`, `mailer-daemon`, `calendar`, `wordpress@`, `wpmudev`);
- the subject does not start with "Accepted:", "Declined:", "Invitation:", "Updated invitation" or "Tentative";
- it is a known person: the ask has `client_id`, or a Mike draft exists on it (`draft_url`), or `intent = sales`;
- it is at least 1 business day old (sales: any age);
- its newest open ask is 21 days old or less (open question 4). Older qualifying threads are counted in Everything else as "older open threads".
"Open" means no sent reply: the classifier marks an ask `handled` when a sent message from Mike appears on the thread after it (`~/.claude/tools/oracle/clarity/email-classifier.py`, `_mike_reply_after` at line 2254 and the resolver around lines 2320 to 2380). A dry run of this rule on tonight's open asks gives about 11 threads inside 21 days (Jessica Everlith, Andy Honeycutt and Mark Mitchell among them); not exact.

Importance, 0 to 100 (sum, capped):
- Client trust, up to 45: +30 when the item belongs to an active client (`client_id` with `Client.status = active`, a thread with `client_id`, a wait with `client_id`); +15 when `promised_to` is set, a wait has `blocks_client`, or a session ask is `client_blocking` or `launch_blocking`; +10 when `requested_by_contact_id` is set, `client_visible` is true, or an open `EmailAsk` is linked by `task_id`.
- Money and lifelines, up to 25: +25 for tags `security`, `security-report`, `lifeline` or `job-watch*`; +15 for `charter_id`, `accord_id` or `billing_amount > 0`; +10 for `site_id`.
- Unblocks others, up to 20: +7 per open task in `blocking` (cap 14); a review sign-off gets 6 plus 1 per 5 pieces (cap 20); a session ask gets 10 (an agent is waiting).
- Base 10.
- Other ventures (client or project name containing "Saiph", "KNT", "Kava News", "Zorp" or "Schoolhouse"): capped at 20. These names are not verified against live client names; the verifier checks them (section 7).

Consequence class (the bands): 1 when the client-trust part is 30 or more; 2 when the money part is 15 or more or a hard date is 7 days away or less; 3 when the unblocks part is above 0; 4 otherwise.

Urgency, 0 to 100 (the highest that applies):
- Hard date: past 100, 2 business days or less 90, 5 or less 70, 10 or less 50, else 20.
- A person waiting (threads, waits with a client, session asks, review sign-offs, tasks with `promised_to` or `requested_by_contact_id`): business days since the wait began (task: `created_at` moved forward only by a human comment, the same clock as `/api/waiting-on-me`; thread: newest ask `received_at`; wait: `client_waiting_since`, else `due_at` when passed). 0 days 10, 1 day 30, 3 days 50, 5 days 65, 10 days 80, 20 or more 90.
- Fresh activity: a thread with a message in the last 24 hours adds 10.
- Anything else: 10.

Next (decisions ready): items not in another tile that are boosted, or a session ask, review sign-off or due wait, or class 1 with urgency 30 or more, or class 2 or 3 with urgency 50 or more. Order: boosted first, then class, then urgency, then oldest. 3 visible. Only the top row's first button is filled.

Today:
- Minutes per item: a thread with a draft 2; a thread without 10; a session ask 5; a wait 5; a review sign-off 10 plus 1 per piece (cap 45); a task uses `estimated_minutes` (it already includes the mystery and battery multipliers, see section 6), else `calculateEstimatedMinutes` from `app/lib/calculations/energy.ts`, else 30. Shown in plain words: "About 10 minutes", "Draft ready, about 2 minutes".
- Quick (cap 3): emergencies outside the day's arc first, then in-view items of 10 minutes or less that have a person waiting or a hard date.
- The arc: take the highest-ranked item in view (emergencies included). If it is a task with an open `Arc` (not closed, not snoozed), the group is that arc and its steps are the arc's open tasks assigned to U plus in-view items for the same client, in rank order. Else the group is the item's client, else its project, else "Indelible" (own work). Cap 4 open steps, never counting steps Mike added.
- Size line: total minutes of quick and steps against free time today from `CalendarEvent` (timed events only) between 10:00 and 17:00 in his time zone, less 30 minutes after each meeting. Steps are cut from the end to fit, never below 1 and never a step he added. When his additions overflow it, the line says so: "About 3 hours 10 minutes, more than today has free".
- Swap: the next two groups by their top item, each with its one-line reason and minutes.
- Lighter today: the group with the fewest minutes whose class number is no higher than the proposed group's.
- Stability: the proposal is written once per zoned day into `home_day` on the first `GET /api/home`, and changes only on Swap, Lighter or his edits. A new emergency is placed at the top of Quick on the next load with no reshuffle.
- His edits: a step he added stays in the day's steps while open, on later days too (`home_item_state.arc_added_at` with the group key); a step he removed is not proposed for that group for 7 days (`arc_removed_at`). In Slice 1, edits change only home records, never `Task.arc_id` (open question 2).

### 1.4 Actions in Slice 1

Existing endpoints, called from the browser through the existing hooks where they exist:
| Button | Item | Endpoint |
|---|---|---|
| Done | task | `PATCH /api/tasks/{id}` `{status:"done"}` |
| I'll do it now | task | `PATCH /api/tasks/{id}` `{status:"in_progress"}`, then home `pin` |
| Open | task | existing peek drawer (`TaskPeekProvider`) |
| Let it go (third Not now) | task | `PATCH /api/tasks/{id}` `{status:"abandoned"}` |
| Approve all {n} | review sign-off | `PATCH /api/tasks/{id}` `{approved:true}` for each piece, in sequence |
| Open the session | session ask | the session's `remote_url` (new tab) |
| Approve / Done | wait | `PATCH /api/waits/{id}` `{action:"resolve", resolution:"approved" or "completed"}`; a price-review wait gets "Open" only, since its approval needs `approved_terms` |
| Open the draft / Open the thread | thread | `draft_url` or `deep_link` (new tab, the one way out) |
| No reply needed | thread | `PATCH /api/email-asks/{id}` `{state:"dismissed"}` for each open ask on the thread |
| Handled | crisis mail | `PATCH /api/email-asks/{id}` `{state:"handled"}` |

Home-only actions, through the new `POST /api/home/act`: `not_now`, `matters_more`, `not_emergency`, `pin`, `stop` (with the "Where did you leave it?" note), `done_pin`, `arc_add`, `arc_remove`, `arc_reorder`, `swap`, `lighter`, and `record` (logs an existing-endpoint action into `home_actions` so the section 7 "where he acts" measure has data from day one). `POST /api/home/undo` reverses any home-only action within 24 hours.

Undo in Slice 1: home-only actions undo through `/api/home/undo`. Task Done, No reply needed and Handled offer "Undo" by calling the same endpoint with the previous value. Approve all, Let it go and wait resolution offer no undo in Slice 1 (whether the task and wait endpoints accept the reverse transition is not verified).

"New task straight into the arc": `POST /api/tasks` with `title` and `assignee_id = U` only (no due date, no priority sent; the API does not force a date), then `arc_add`.

## 2. Slice 1 task list for builder agents

Branch: `feat/home-screen-slice1`, from `origin/main`.
Worktree: `/home/mike/.openclaw/workspace/citadel-home-wt`. Below, `W` means that path and `A` means `W/app`.

Model mix (state before spend): Opus high for H3 (the shared contract) and V1 (review). Sonnet medium for H1, H4, H5, H6, H7, H9a, H9b, H9c, H10, H11, H12. Haiku low for H0, H2, H8. No Fable anywhere.

Shell rules for every agent (pass these in each prompt): absolute paths; never `cd` in a command that deletes; never `rm` a relative glob; delete nothing outside the agent's own scratchpad; never push, never merge to `main`; never call production Citadel with anything but GET (and builders need no production access at all).

Every task's checks run from `A`. "tsc" means `cd A && npx tsc --noEmit`. On a failed check, re-dispatch the task once with the command's stderr, then escalate.

| Id | What | Files it owns | Depends on | Model, effort |
|---|---|---|---|---|
| H0 | Set up worktree and baseline | `implementation/plans/home-screen-slice1.md` (copy of this plan) | none | Haiku, low |
| H1 | Schema and migration | `app/prisma/schema.prisma`, `app/prisma/migrations/20261110010000_home_screen_slice1/migration.sql` | H0 | Sonnet, medium |
| H2 | Preference field in API and hook | `app/app/api/users/me/preferences/route.ts`, `app/app/api/users/me/preferences/__tests__/route.test.ts`, `app/lib/hooks/use-preferences.ts` | H1 | Haiku, low |
| H3 | Contract and pure basics | `app/lib/home/types.ts`, `app/lib/home/item-key.ts`, `app/lib/home/plain-text.ts`, `app/lib/home/rules.ts`, `app/lib/home/__tests__/item-key.test.ts`, `app/lib/home/__tests__/plain-text.test.ts`, `app/lib/home/__tests__/rules.test.ts` | H1 | Opus, high |
| H4 | Scoring, selection, Today proposal, copy | `app/lib/home/score.ts`, `app/lib/home/select.ts`, `app/lib/home/today.ts`, `app/lib/home/copy.ts`, `app/lib/home/actions-for.ts`, `app/lib/home/__tests__/score.test.ts`, `app/lib/home/__tests__/select.test.ts`, `app/lib/home/__tests__/today.test.ts`, `app/lib/home/__tests__/copy.test.ts`, `app/lib/home/__tests__/actions-for.test.ts`, `app/lib/home/__tests__/fixtures/tonight.ts`, `app/lib/home/__tests__/tonight.test.ts`, `app/lib/home/__tests__/copy-guard.test.ts` | H3 | Sonnet, medium |
| H5 | Loader, state store, access gate | `app/lib/home/load.ts`, `app/lib/home/state.ts`, `app/lib/home/gate.ts`, `app/lib/home/__tests__/load.test.ts`, `app/lib/home/__tests__/state.test.ts`, `app/lib/home/__tests__/gate.test.ts` | H3 | Sonnet, medium |
| H6 | `GET /api/home` | `app/app/api/home/route.ts`, `app/app/api/home/__tests__/route.test.ts` | H4, H5 | Sonnet, medium |
| H7 | `POST /api/home/act` and `/undo` | `app/lib/home/act.ts`, `app/lib/home/__tests__/act.test.ts`, `app/app/api/home/act/route.ts`, `app/app/api/home/act/__tests__/route.test.ts`, `app/app/api/home/undo/route.ts`, `app/app/api/home/undo/__tests__/route.test.ts` | H4, H5 | Sonnet, medium |
| H8 | Registry entries | `app/lib/api/registry/dashboard.ts` | H3 | Haiku, low |
| H9a | Client hooks | `app/lib/hooks/use-home.ts`, `app/lib/hooks/__tests__/use-home.test.ts` | H3 | Sonnet, medium |
| H9b | Screen shell, tiles, list, card, tokens | `app/components/domain/home/HomeScreen.tsx`, `TileStrip.tsx`, `ItemList.tsx`, `ItemCard.tsx`, `WorkingOnBar.tsx`, `home-screen-logic.ts`, `home-tokens.css`, `__tests__/home-screen-logic.test.ts`, `__tests__/ItemCard.test.tsx`, `__tests__/TileStrip.test.tsx`, `__tests__/HomeScreen.test.tsx`, `__tests__/home-tokens-contrast.test.ts`, `__tests__/no-red.guard.test.ts` (all under `app/components/domain/home/`) | H9a | Sonnet, medium |
| H9c | Today list and arc editing | `app/components/domain/home/TodayList.tsx`, `ArcEditor.tsx`, `AddToArcSearch.tsx`, `today-list-logic.ts`, `__tests__/today-list-logic.test.ts`, `__tests__/TodayList.test.tsx`, `__tests__/ArcEditor.test.tsx` | H9a | Sonnet, medium |
| H10 | `/dashboard` switch | `app/app/(app)/dashboard/page.tsx`, `app/app/(app)/dashboard/__tests__/page.test.tsx` | H2, H9b, H9c | Sonnet, medium |
| H12 | Local fixture seed for eyeballing | `app/scripts/seed-home-fixtures.ts` | H1 | Sonnet, medium |
| H11 | Final executed gate | none (runs commands, writes its log to its scratchpad) | all above | Sonnet, medium |
| V1 | Adversarial review on top of the gate | none | H11 green | Opus, high |

No file appears in two rows. `HomeScreen.tsx` (H9b) imports `TodayList` from H9c by the props fixed in H3's `types.ts` (section 2.1), so H9b and H9c run in parallel and meet at the H10 and H11 type-check.

Run order:
1. H0.
2. H1.
3. In parallel: H2, H3, H12.
4. After H3, in parallel: H4, H5, H8, H9a.
5. After H4 and H5, in parallel: H6, H7. After H9a, in parallel: H9b, H9c.
6. H10 after H2, H9b, H9c.
7. H11, then V1.

### 2.1 Task details

H0 (setup and baseline)
- `git -C /home/mike/.openclaw/workspace/citadel fetch origin`, then `git -C /home/mike/.openclaw/workspace/citadel worktree add -b feat/home-screen-slice1 /home/mike/.openclaw/workspace/citadel-home-wt origin/main`.
- `npm --prefix A ci`.
- Copy this plan to `W/implementation/plans/home-screen-slice1.md` (the repo's plan-file rule).
- Baseline, logged to the agent's scratchpad: `cd A && npx tsc --noEmit; echo tsc=$?` and `cd A && npx vitest run 2>&1 | tail -40` (the whole unit suite, no e2e). Record the failing test files, if any, so H11 can tell new failures from old ones.
- Check: `git -C W status --porcelain` shows only the copied plan.

H1 (schema and migration)
- Add the model text from section 3 to `app/prisma/schema.prisma`, including the three back-relations on `User`.
- Generate the SQL without a database: `git -C W show origin/main:app/prisma/schema.prisma > <scratch>/schema-main.prisma`, then `cd A && npx prisma migrate diff --from-schema-datamodel <scratch>/schema-main.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261110010000_home_screen_slice1/migration.sql`. Add a two-line comment at the top naming the slice. Hand-check that it only creates a type, three tables, indexes, foreign keys and one `ADD COLUMN ... NOT NULL DEFAULT 'overlook'`.
- Checks:
  - `cd A && npx prisma validate` exits 0.
  - `cd A && npx prisma generate` exits 0.
  - Apply every migration to a throwaway Postgres and prove no drift:
    - `docker run -d --rm --name citadel-home-mig-check -e POSTGRES_USER=citadel -e POSTGRES_PASSWORD=citadel -e POSTGRES_DB=migcheck -p 55433:5432 postgres:16-alpine`
    - `timeout 90 bash -c 'until docker exec citadel-home-mig-check pg_isready -U citadel -q; do :; done'`
    - `cd A && DATABASE_URL=postgresql://citadel:citadel@localhost:55433/migcheck npx prisma migrate deploy` exits 0.
    - `cd A && npx prisma migrate diff --from-url postgresql://citadel:citadel@localhost:55433/migcheck --to-schema-datamodel prisma/schema.prisma --exit-code` exits 0 (no drift).
    - Keep the container running for H12 and H11; H11 stops it with `docker stop citadel-home-mig-check` (the `--rm` flag removes it).
  - `cd A && npx tsc --noEmit` shows no new errors against the H0 baseline.

H2 (preference field)
- Route: add `home_view: z.enum(['overlook','home']).optional()` to the PATCH schema; add `home_view` to both `select` blocks, to the GET default object (`'overlook'`) and to the upsert `create` branch (`validated.home_view ?? 'overlook'`). If `home_view === 'home'` and `auth.role !== 'admin'`, throw `new AuthError('Only an admin can turn on the home screen', 403)`. Setting `'overlook'` is always allowed.
- Hook: add `home_view: 'overlook' | 'home'` to `UserPreferences`.
- Tests to add in the existing file: GET defaults `home_view` to `overlook` with no row; GET returns a stored `home`; PATCH `home` as admin persists; PATCH `home` as `pm` and as `tech` returns 403 and never calls `upsert`; PATCH `overlook` as `tech` succeeds; invalid value returns 400.
- Checks: `cd A && npx vitest run app/api/users/me/preferences/__tests__/route.test.ts components/domain/oracle/today/__tests__/TodaySection.test.tsx lib/auth/__tests__/designer-routes.test.ts`; `cd A && npx eslint app/api/users/me/preferences/route.ts lib/hooks/use-preferences.ts`; tsc.

H3 (contract and pure basics; Opus because every later task builds on it)
- `types.ts`: the `HomeResponse` shape (below), `HomeItem`, `HomeItemType`, `HomeActionId`, `HomeActRequest` (discriminated union for every home-only action in 1.4), `HomeActResponse`, `HomeUndoRequest`, the raw loader inputs (`RawTask`, `RawReviewFold`, `RawSessionAsk`, `RawWait`, `RawThread`, `RawCrisis`, `RawCalendarEvent`, `RawItemState`, `RawHomeDay`) and the props of `TodayList`, `ArcEditor`, `ItemCard`, `TileStrip`.
- `item-key.ts`: build and parse keys (`task:`, `review:`, `session:`, `wait:`, `thread:`, `crisis:`); reject anything else.
- `plain-text.ts`: BlockNote JSON or a plain string to plain text; first paragraph; truncate at about 60 words on a word boundary. The repo has no such helper today (`app/lib/api/blocknote.ts` only goes markdown to blocks).
- `rules.ts`: every constant from section 1.3 (noise list, own addresses, automated patterns, calendar subjects, ventures, emergency tag sets, caps 3/3/4, window 21 days, thresholds) and the pure emergency predicates.
- Response shape:
  - `generated_at`, `date` (YYYY-MM-DD in his zone), `timezone`, `screen_date_line` ("Monday, November 9").
  - `today`: `group_key`, `arc_id` or null, `arc_name`, `why`, `size_line`, `quick[]`, `steps[]`, `added_keys[]`, `swap[]` (`group_key`, `name`, `why`, `minutes`), `lighter` (or null).
  - `sections`: `needs_you_now[]`, `working_on[]`, `leads[]`, `mail[]`, `next[]`, `handled[]` (quiet lines: `text`, `href` or null, `at`).
  - `everything_else`: `count`, `line`, `groups[]` (`label`, `count`, `owner`).
  - `HomeItem`: `key`, `type`, `title`, `who`, `age`, `why_now`, `hard_date` (chip text or null), `effort`, `minutes`, `actions[]` (at most 3 visible), `more_actions[]`, `default_if_ignored`, `reason` ("Why it's here"), `opened` (`summary`, `done_when[]`, `how` link or null, `links[]` of label and href, `task_id` or null, `left_off_note` or null), `source` (`kind`, `id`, `ids[]` for folds and threads), `client` and `project` (id and name or null). No score, class or priority field.
- Checks: `cd A && npx vitest run lib/home/__tests__/item-key.test.ts lib/home/__tests__/plain-text.test.ts lib/home/__tests__/rules.test.ts`; `cd A && npx eslint lib/home/types.ts lib/home/item-key.ts lib/home/plain-text.ts lib/home/rules.ts`; tsc.

H4 (scoring, selection, Today, copy)
- `score.ts`: importance, class and urgency exactly as section 1.3, using `addBusinessDays` and `isBusinessDay` from `app/lib/waits/business-days.ts`.
- `select.ts`: raw inputs plus item states plus now to the `sections` and `everything_else`. Applies Not now (`view_at` in the future hides; `park_count` 3 swaps the buttons to the real choices plus "Let it go"), boosts, `not_emergency_at`, caps and orders.
- `today.ts`: the proposal (quick, group, steps, size, swap, lighter) from ranked items, calendar events and Mike's add and remove marks; plus `applyEmergencyInsert` for a new emergency on a later load.
- `copy.ts`: every reader-facing string: date line, elapsed age ("10 days", "filed today"), effort words, size line, hard-date chip, why lines, "If you do nothing" lines that only state what really happens in Slice 1, empty sentences from the design, the Everything-else sentence.
- `actions-for.ts`: which buttons each item gets (table in 1.4), filled first button only on the top Next row, "Not now" and "This matters more" on every non-emergency, "Not an emergency" on emergencies.
- `fixtures/tonight.ts` and `tonight.test.ts`: a hand-built fixture from tonight's data (the Grok security task with tag `security` and its arc of 4 open steps, the Claude sign-in task with tag `job-watch` due 2026-11-14, the VCDP review fold of 39 pieces, Jessica Everlith's thread with a draft, Andy Honeycutt's thread with a draft, the Stronghold session ask, a jillscafe crisis mail, a collectiveyouth crisis mail). Asserts: Needs you now holds the sign-in, the Grok task and the jillscafe mail but not collectiveyouth; Today's group is the Grok arc; Quick has at most 3 rows with the sign-in first; steps at most 4; Next has 3 visible rows; no row text matches `/priority|P[1-5]\b|overdue/i`.
- `copy-guard.test.ts`: scans `app/lib/home` and `app/components/domain/home` source with comments stripped (same method as `app/lib/oracle/projects/__tests__/dash-law-guard.test.ts`) and fails on an em dash or en dash in any string or JSX text.
- Checks: `cd A && npx vitest run lib/home/__tests__/score.test.ts lib/home/__tests__/select.test.ts lib/home/__tests__/today.test.ts lib/home/__tests__/copy.test.ts lib/home/__tests__/actions-for.test.ts lib/home/__tests__/tonight.test.ts lib/home/__tests__/copy-guard.test.ts`; eslint on the five source files; tsc.

H5 (loader, state, gate)
- `load.ts`: one function `loadHomeInputs(prisma, userId, now)` that runs the reads of section 1.1 with `Promise.all`, reuses `loadWaitCandidates` and `BOT_USER_IDS` (for the human-comment clock), reads today's `CalendarEvent` rows, the classifier auto-closes of the last 24 hours (`EmailAsk` with `state = handled`, `updated_at` within 24 hours, `training_note` starting `[auto] `), and returns the raw types from H3. It must not call `/api/today` or `rolloverTodayPicksIfNeeded`.
- `state.ts`: read all `home_item_state` rows for the user; read or create today's `home_day` (create catches Prisma `P2002` and re-reads, like `app/lib/services/today-rollover.ts`); write helpers used by `act.ts`; append to `home_actions`.
- `gate.ts`: `requireHomeUser()` returns the auth payload when `role === 'admin'` and the caller's own `home_view === 'home'`; else throws `AuthError(403)`.
- Checks: `cd A && npx vitest run lib/home/__tests__/load.test.ts lib/home/__tests__/state.test.ts lib/home/__tests__/gate.test.ts` (Prisma mocked, the repo's pattern); eslint on the three files; tsc.

H6 (`GET /api/home`)
- `requireHomeUser()`, `resolveUserTimezone`, `loadHomeInputs`, read or create `home_day` (first load of the zoned day writes the proposal from `today.ts`), `select`, then respond with `Cache-Control: no-store`. Takes no `user_id` parameter.
- Tests: 401 without auth; 403 for admin with `home_view` overlook; 403 for `pm` with `home` (if such a row ever existed); 200 shape for Mike; second call the same day reuses `home_day` and does not create another; a new emergency on the second call lands at the top of Quick without changing `steps`.
- Checks: `cd A && npx vitest run app/api/home/__tests__/route.test.ts`; eslint on the route; tsc.

H7 (act and undo)
- `act.ts`: a pure reducer from `HomeActRequest` plus current state to the writes and the undo record. Not now ladder (next business day 9:00 in his zone, then 7 days, then choices only); boost; not-emergency; pin (one at a time; a second pin without `switch: true` returns 409 with the message "Switch to this one? The other goes back to its place."); stop with note; arc add, remove, reorder (order kept in `home_day.step_item_keys`; add and remove marks in `home_item_state`); swap and lighter (rewrite today's `home_day` group and steps); record.
- Routes: Zod-validated bodies, `requireHomeUser()`, every write and its `home_actions` row in one `prisma.$transaction`. Undo reverses the stored before-state when `undo_until` has not passed and `undone_at` is null; else 409.
- Tests per action, plus: undo after 24 hours is refused; undo twice is refused; act and undo return 403 for a non-home user.
- Checks: `cd A && npx vitest run lib/home/__tests__/act.test.ts app/api/home/act/__tests__/route.test.ts app/api/home/undo/__tests__/route.test.ts`; eslint on the three source files; tsc.

H8 (registry)
- Add `/api/home` (GET), `/api/home/act` (POST) and `/api/home/undo` (POST) to `app/lib/api/registry/dashboard.ts` with group `dashboard`, `auth: 'required'`, roles admin, body schemas, response examples and a note that they answer 403 unless the caller's own `home_view` is `home`. Using the existing `dashboard` group keeps the registry test's fixed group list unchanged.
- Checks: `cd A && npx vitest run lib/api/registry/__tests__/registry.test.ts app/api/docs/__tests__/route.test.ts`; `cd A && npx eslint lib/api/registry/dashboard.ts`.

H9a (client hooks)
- `useHome()` (React Query, `refetchOnWindowFocus: false`, so nothing reorders while he looks), `useHomeAct()`, `useHomeUndo()`, and `useHomeItemAction(item)` that maps each `HomeActionId` to the existing hooks (`useUpdateTask` from `use-tasks.ts`, the email-ask and wait hooks from `use-email-asks.ts` and `use-waits.ts`), then posts `record`, then refetches `/api/home`. Results go through `showToast` with an Undo where section 1.4 allows one.
- Checks: `cd A && npx vitest run lib/hooks/__tests__/use-home.test.ts`; `cd A && npx eslint lib/hooks/use-home.ts`; tsc.

H9b (shell, tiles, list, card, tokens)
- Layout from `design/home-preview-template.html`, inside the existing app shell: date line; tile strip (grid of auto-fit columns, minimum 150 px, Today tile spans two columns and one at 420 px and below); two panes (list at `minmax(300px, 30%)`, card beside) from 900 px up, stacked below. Today is selected on load with the first arc step open in the card.
- Tokens: `home-tokens.css` scoped under `[data-home]`, imported by `HomeScreen.tsx` (the portal's pattern, `app/app/(portal)/portal-tokens.css`). It adds `--accent-text`, `--accent-ink`, `--warning-line` and overrides `--text-muted`, `--warning` and `--success` with the preview's values, for light, dim, dark and system dark. `app/app/globals.css` is not touched, so no other screen changes.
- Needs you now uses the muted gold rule (`--warning-line`) down the row edge only. Never red: no `--error`, `text-red`, `bg-red`, `text-error` or `bg-error` in this folder (`no-red.guard.test.ts` enforces it).
- `ItemCard`: the 2B order; "Done when" only when there is more than one deliverable; Links as named links; footer lines muted. "Original notes" opens the existing peek drawer.
- `WorkingOnBar`: the pinned item with Done and Stop for now; collapses the other lists to one line ("3 more in Next. They'll keep.").
- Empty sentences exactly as the design gives them. Browser tab title stays "Citadel".
- `HomeScreen` wraps its tree in `TaskPeekProvider`. If `/api/home` fails it shows one line, "This screen could not load.", and a link to `/dashboard?view=overlook`.
- `home-tokens-contrast.test.ts`: parse the file and require 4.5:1 for every text token on its background in each theme (same idea as `app/lib/portal/__tests__/tokens-contrast.test.ts`).
- Checks: `cd A && npx vitest run components/domain/home/__tests__/home-screen-logic.test.ts components/domain/home/__tests__/ItemCard.test.tsx components/domain/home/__tests__/TileStrip.test.tsx components/domain/home/__tests__/HomeScreen.test.tsx components/domain/home/__tests__/home-tokens-contrast.test.ts components/domain/home/__tests__/no-red.guard.test.ts`; eslint on the source files; tsc after H9c lands.

H9c (Today list and arc editing)
- `TodayList`: groups "Quick, before you start" and "Today's arc: {name}", the day foot (size line, "Why this arc: ...", "Lighter today", "Swap arc" with the two choices; picking one calls `swap`).
- `ArcEditor`: "Remove from arc" under More on each step; drag to reorder with `@dnd-kit/sortable` (already a dependency); keyboard reorder through dnd-kit's keyboard sensor.
- `AddToArcSearch`: one box under the arc; searches his in-view items from the payload first (same client first), then his open tasks through the existing `GET /api/tasks?search=...&assignee_id=...&statuses=not_started,in_progress,blocked,review`; Enter on text with no match creates the task (`POST /api/tasks`, title and assignee only) and adds it. "Add to today's arc" also appears under More on every other row.
- Checks: `cd A && npx vitest run components/domain/home/__tests__/today-list-logic.test.ts components/domain/home/__tests__/TodayList.test.tsx components/domain/home/__tests__/ArcEditor.test.tsx`; eslint on the source files; tsc after H9b lands.

H10 (`/dashboard` switch)
- In `app/app/(app)/dashboard/page.tsx`: change only `export default function OverlookPage()` to `function OverlookPage()` and add a default-exported `DashboardRoute` that reads `usePreferences()` and `useSearchParams()` inside a `React.Suspense` boundary. It renders `HomeScreen` only when `home_view === 'home'` and `view` is not `overlook`; in every other case, including a failed or loading preferences call, it renders `OverlookPage` exactly as today (loading shows the same spinner the Overlook shows). The Overlook's own code is not edited.
- `page.test.tsx`: Overlook for `home_view` overlook, missing, and request error; HomeScreen for `home`; Overlook for `home` plus `?view=overlook`.
- Checks: `cd A && npx vitest run "app/(app)/dashboard/__tests__/page.test.tsx"`; `cd A && npx eslint "app/(app)/dashboard/page.tsx"`; `git -C W diff origin/main -- "app/app/(app)/dashboard/page.tsx"` shows only the export line change plus the new wrapper; tsc.

H12 (fixture seed for looking by eye)
- A script modeled on `app/scripts/seed-clarity-phase8-fixtures.ts`: refuses to run unless `DATABASE_URL` contains `localhost:55433`; creates an admin user with a dev password, `home_view = home`, and fixtures matching `tonight.ts` (clients, an arc, tasks, review pieces, an `OracleSession` ask, email asks, one calendar event).
- Check: `cd A && DATABASE_URL=postgresql://citadel:citadel@localhost:55433/migcheck npx tsx scripts/seed-home-fixtures.ts` exits 0 and prints the user email (whether `tsx` is installed is not verified; fall back to the `ts-node` line the repo's `prisma.seed` script uses).

H11 (final executed gate; exit codes decide, not summaries)
1. `cd A && npx prisma validate`
2. `cd A && npx tsc --noEmit` with no new errors against H0's baseline.
3. `cd A && npx vitest run lib/home app/api/home components/domain/home lib/hooks/__tests__/use-home.test.ts "app/(app)/dashboard/__tests__/page.test.tsx" app/api/users/me/preferences/__tests__/route.test.ts lib/api/registry/__tests__/registry.test.ts app/api/docs/__tests__/route.test.ts lib/auth/__tests__/lane-scopes.test.ts lib/auth/__tests__/designer-routes.test.ts components/domain/oracle/today/__tests__/TodaySection.test.tsx lib/portal/__tests__/tokens-contrast.test.ts lib/oracle/projects/__tests__/dash-law-guard.test.ts` exits 0.
4. `cd A && npx vitest run` (whole unit suite): no failing file that was not already failing in H0's baseline.
5. `cd A && npx eslint $(git -C W diff --name-only --diff-filter=AM origin/main -- 'app/**/*.ts' 'app/**/*.tsx' | sed 's#^app/##')` exits 0.
6. Migration apply and drift check from H1 against a fresh container, then `docker stop citadel-home-mig-check`.
7. `cd A && NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build` exits 0.
8. Allowed-files check: `git -C W diff --name-only origin/main` lists only the files owned in the table above. In particular, no change under `app/components/domain/dashboard/`, `app/components/layout/`, `app/app/globals.css`, `app/app/api/waiting-on-me/`, `app/app/api/today/`, `app/app/api/dashboard/` or `app/app/(app)/oracle/`.
9. Log every command and exit code. Commit on the branch only when 1 to 8 pass; never push.

V1 (review, on top of a green H11): read the diff cold against sections 1 and 4 of this plan and the design's non-negotiables. Look hardest at: any path where a non-Mike user could get the home screen or `/api/home`; any shared record written by a home-only action; any reader-facing text that promises a later slice's behavior; any red; rows that do not read cold.

## 3. Schema

All additive. One new enum, one defaulted column on an existing table, three new tables. No existing column changes.

```prisma
// Home screen (specs/home-build-plan.md, Slice 1). Per-user first-screen switch. Default
// overlook: every user keeps today's Overlook unless their own row says home.
enum HomeView {
  overlook
  home
}
```

On `UserPreference`, after `energy_filter`:
```prisma
  // Home screen Slice 1: which first screen /dashboard renders for this user.
  home_view           HomeView         @default(overlook)
```

On `User`, with the other back-relations:
```prisma
  home_item_states HomeItemState[] @relation("HomeItemStateUser")
  home_days        HomeDay[]       @relation("HomeDayUser")
  home_actions     HomeAction[]    @relation("HomeActionUser")
```

New models:
```prisma
// Home screen Slice 1: one row per item the home screen has shown or the user has acted on,
// for that user only. Never read by any other screen. Later slices add the keeper's columns.
model HomeItemState {
  id                String    @id @default(uuid()) @db.Uuid
  user_id           String    @db.Uuid
  user              User      @relation("HomeItemStateUser", fields: [user_id], references: [id], onDelete: Cascade)
  item_key          String    @db.VarChar(300)
  park_count        Int       @default(0)
  view_at           DateTime?
  boosted_at        DateTime?
  not_emergency_at  DateTime?
  working_since     DateTime?
  left_off_note     String?   @db.Text
  arc_added_at      DateTime?
  arc_added_group   String?   @db.VarChar(120)
  arc_removed_at    DateTime?
  arc_removed_group String?   @db.VarChar(120)
  first_seen_at     DateTime  @default(now())
  last_shown_at     DateTime?
  created_at        DateTime  @default(now())
  updated_at        DateTime  @updatedAt

  @@unique([user_id, item_key])
  @@index([user_id, view_at])
  @@map("home_item_state")
}

// Home screen Slice 1: the day's proposal, written once per zoned day and changed only by
// Swap, Lighter or the user's own edits. arc_id is a plain id (no relation) so an arc's
// later close or edit never touches this row.
model HomeDay {
  id                 String    @id @default(uuid()) @db.Uuid
  user_id            String    @db.Uuid
  user               User      @relation("HomeDayUser", fields: [user_id], references: [id], onDelete: Cascade)
  date               DateTime  @db.Date
  group_key          String    @db.VarChar(120)
  group_label        String    @db.VarChar(300)
  arc_id             String?   @db.Uuid
  quick_item_keys    String[]  @default([]) @db.VarChar(300)
  step_item_keys     String[]  @default([]) @db.VarChar(300)
  sized_minutes      Int?
  proposed_at        DateTime  @default(now())
  started_at         DateTime?
  swapped_from_group String?   @db.VarChar(120)
  lighter_at         DateTime?
  created_at         DateTime  @default(now())
  updated_at         DateTime  @updatedAt

  @@unique([user_id, date])
  @@map("home_day")
}

// Home screen Slice 1: every home-only action with its before and after, for undo and for
// the "where he acts" measure. Rows are never deleted.
model HomeAction {
  id         String    @id @default(uuid()) @db.Uuid
  user_id    String    @db.Uuid
  user       User      @relation("HomeActionUser", fields: [user_id], references: [id], onDelete: Cascade)
  item_key   String?   @db.VarChar(300)
  action     String    @db.VarChar(60)
  before     Json?
  after      Json?
  undo_until DateTime?
  undone_at  DateTime?
  source     String    @default("home") @db.VarChar(30)
  created_at DateTime  @default(now())

  @@index([user_id, created_at])
  @@index([user_id, item_key])
  @@map("home_actions")
}
```

Differences from the design's 5.3 list, on purpose: `home_item_state` carries only what Slice 1 writes (importance, urgency, reason, owner, card summary and the rest arrive with the keeper in Slice 2); "Working on" is stored as `home_item_state.working_since` instead of `TodayPick.started_at` (section 6, finding 5); `home_score_weights`, `Task.hard_due_at`, `Task.hard_due_source` and `EmailOutbox.send_after` arrive with the slices that write them.

How the migration reaches production (read from `.github/workflows/deploy.yml`):
- A push to `main` runs the workflow: `npm ci` and `npm run build` in CI (no database needed), then the build, `public/`, `package*.json` and `prisma/` are copied to the server, then on the server: `npm ci --production`, `npx prisma generate`, `npx prisma migrate deploy`, `pm2 restart citadel`, under `set -e`.
- So yes, migrations apply automatically, and they apply before the restart. With app code and schema in one push, the new code starts only after the migration has run, so it never sees a missing table. Because the change is additive, the old process still running during the migration is unaffected.
- If `migrate deploy` fails, `set -e` stops the step, pm2 is not restarted, and the workflow files a "[Deploy FAILED]" task for Mike. The old `.next` has already been replaced by then (an existing property of this workflow, not new here), so a failed migration can leave the site unhealthy until fixed; the H1 and H11 apply-and-drift checks against a clean Postgres are what make that unlikely.
- Prisma wraps each PostgreSQL migration in a transaction; this one has no statement that cannot run in one (no `ALTER TYPE ... ADD VALUE`).
- No other recent branch carries an unmerged migration (checked with `git diff main...<branch> -- app/prisma/migrations` across local branches; the newest with one is from 2026-10-22). Whether `migrate deploy` would apply an older-timestamped migration merged later is not verified.
- Turning the slice off never needs a migration (section 4). Reverting the code leaves the three tables and the column in place, unused and harmless.

## 4. Per-user scoping

- The switch is `UserPreference.home_view`, default `overlook`. After deploy every row reads `overlook`, so every user, Mike included, still sees today's Overlook until it is turned on.
- Landing route: `/` redirects to `/dashboard` (`app/app/page.tsx` line 4) and login pushes to `/dashboard` (`app/app/(auth)/login/page.tsx` line 43). `/dashboard` reads the caller's own preference through `usePreferences()`, the same cached query `ThemeProvider` already makes on every page, so other users pay no extra request. `home` renders `HomeScreen`; anything else, including a failed preferences call, renders the Overlook through its unchanged code (`AdminOverlook`, `PmOverlook`, `TechOverlook`). Sabeen is a `tech` user and keeps `TechOverlook`.
- Turning it on for Mike (after Mike says deploy and the deploy is green): one request as Mike, `PATCH /api/users/me/preferences` with `{"home_view":"home"}`. Bast can send it with Mike's token once Mike says go; it is the only production write in the rollout.
- Turning it off, one step: the same request with `{"home_view":"overlook"}`. For a single visit without changing anything, `/dashboard?view=overlook`.
- Who can turn it on: only an admin, and only for their own row (the PATCH route always writes the caller's row). `/api/home`, `/api/home/act` and `/api/home/undo` answer 403 unless the caller is an admin whose own `home_view` is `home`. The design asked only for the preference check (5.4); the admin check is added because every source the screen reads (email asks, session asks, Today picks) is already admin-only.
- What the new code writes: only `home_item_state`, `home_day`, `home_actions` for the caller. Shared records change only through the existing endpoints Mike taps (task status, review approval, email ask state, wait resolution), exactly as they do from the Seeing Stone today. In Slice 1 the arc edits never change `Task.arc_id`.
- What does not change for anyone: `globals.css`, the sidebar, the header and bell, the Overlook components, `/api/dashboard`, `/api/tasks`, `/api/waiting-on-me`, `/api/today`, `/api/waits/mine`, the Seeing Stone. Mike can still open the Seeing Stone from the sidebar.
- Note on identity: production API tokens tied to Mike's user (such as the one used for these reads) are Mike as far as Citadel knows, so a script using that token could call `/api/home/act`. Lane keys are refused on the new routes because no lane lists them (`app/lib/auth/lane-scopes.ts`), when the lane is enforced.

## 5. Impact analysis

Done by reading the code and grepping callers and tests, as `CLAUDE.md` requires.

Existing files changed, and who depends on them:
| File | Change | Callers and dependents | Tests that must keep passing |
|---|---|---|---|
| `app/prisma/schema.prisma` | new enum, one column, three models, three `User` back-relations | every Prisma caller (types only; additive) | whole suite type-checks; `prisma validate` |
| `app/app/api/users/me/preferences/route.ts` | `home_view` in select, default, create, PATCH schema; admin rule | `use-preferences.ts`, which feeds `ThemeProvider`, `use-terminology`, `TodaySection`, the settings page (all send partial PATCH bodies, checked) | `app/api/users/me/preferences/__tests__/route.test.ts` (extended), `lib/auth/__tests__/designer-routes.test.ts` (lists this route for designers; designers are not admins, so `home` is refused for them) |
| `app/lib/hooks/use-preferences.ts` | one field in the interface | same as above | `components/domain/oracle/today/__tests__/TodaySection.test.tsx` |
| `app/lib/api/registry/dashboard.ts` | three entries | `GET /api/docs` | `lib/api/registry/__tests__/registry.test.ts` (fixed group list; using `dashboard` keeps it green), `app/api/docs/__tests__/route.test.ts` |
| `app/app/(app)/dashboard/page.tsx` | export line plus a wrapper | rendered for every user at `/dashboard`; no test imports it today (grep found none) | new `page.test.tsx` |

New route folders `app/app/api/home/...`: `lib/auth/__tests__/lane-scopes.test.ts` walks every `route.ts`; no lane pattern has a `:param` at the `/api/` root, so the new static routes add no gap (checked). `app/lib/sends/__tests__/outbox-single-writer.test.ts` is unaffected (Slice 1 writes no `EmailOutbox` rows).

Not changed, read only: `app/lib/waits/load-blocks.ts` (`loadWaitCandidates`), `app/lib/waits/business-days.ts`, `app/lib/oracle/projects/gate-constants.ts` (`BOT_USER_IDS`, `MIKE_USER_ID`), `app/lib/calculations/energy.ts`, `app/lib/services/user-timezone.ts`, `app/lib/contexts/task-peek-context.tsx`, `ProjectDrawer`, `useOracleProjects`, the task, email-ask and wait hooks.

The design says `/api/home` "reads `/api/waiting-on-me`, not changed" (5.2). That route's logic is inline in its handler (`app/app/api/waiting-on-me/route.ts`), not a library, and one route calling another over HTTP is not a pattern this repo uses. Slice 1 re-reads the same tables in `app/lib/home/load.ts` with the same filters and leaves `waiting-on-me` untouched.

E2E (Playwright) specs are not run by this plan. `__tests__/e2e/` holds Seeing Stone specs that touch preferences seeding; they do not cover `/dashboard` (not verified by running them).

## 6. Risks, open questions, and where the design and the code disagree

Where the codebase contradicts the design:
1. Mystery multipliers. Design 2C.4 says "the existing mystery multiplier (1, 1.4, 1.75, 2.5)". The code uses 1.0, 1.61, 2.5 and 4.2 (`app/lib/calculations/energy.ts` lines 3 to 8); the schema comments still say 1x, 1.4x, 1.75x, 2.5x (`app/prisma/schema.prisma` lines 1365 to 1370). `estimated_minutes` already includes the multipliers (27 = 15 x 1.61 x 1.1), so Slice 1 uses it as is and never multiplies again.
2. Energy values. Design 2C says no task carries an energy, mystery or battery value other than the default. Live: of Mike's 197 open tasks, 122 have `energy_estimate` and 71 have mystery `average`; battery is default on all but one. Who set them is not verified.
3. Emergency tags. Design 1.1 relies on tags `security`, `lifeline` and `client-blocking`. Live: the Grok security task (`7aa4a01a`) has no tags at all; the Claude sign-in task carries `job-watch` and `job-watch:claude-signin`, not `lifeline`; no task carries `client-blocking`. Slice 1 adds the `job-watch` prefix to the rule; the Grok task needs a tag (question 3).
4. Email ask fields. Design 1.1 and 3.2 use `EmailAsk.severity = client_blocking` and `queue` decide or answer. Live: on all 493 open non-urgent asks, `severity` is null and `queue` is `review` or null. Those rules would match nothing. Slice 1 uses the open state (no sent reply) plus the known-person rule in 1.3.
5. Working on. Design 1.2 and 5.2 build the pin on `TodayPick.started_at`. `TodayPick` has no user column (`app/prisma/schema.prisma` line 3053 on), and rollover carries `started_at` forward: tonight 3 of 8 picks show started dates of October 15, October 16 and November 4. Reading it would show three stale items in progress. Slice 1 keeps the pin in `home_item_state.working_since`.
6. Ritual stamp. Design 2C.2 has the keeper stamp `RitualRun.quickstart_at` "so the Seeing Stone's gate is satisfied". The gate was retired on 2026-10-12 (`app/app/(app)/oracle/page.tsx` line 102). Nothing to stamp.
7. GET writes. `GET /api/today` runs a once-a-day rollover that writes picks (`app/app/api/today/route.ts` line 72, `app/lib/services/today-rollover.ts`). The home loader never calls it. Planning note: this plan's own read of `GET /api/today` at about 23:55 UTC found the day's rollover already done (picks created 17:24 UTC), so the marker existed and that read made no change, as far as the code shows.
8. Tokens. The preview uses `--accent-text`, `--accent-ink` and `--warning-line`, none of which exist in `app/app/globals.css`, and different values for `--text-muted` (#767676 against #888888, line 117), `--warning` (#8A6D1C against #C4A24D, line 125) and `--success` (#4F7F5E against #6B9B7A, line 123). Changing `globals.css` would change every user's screens, so Slice 1 scopes these under `[data-home]`.
9. Session asks have no options. Design 2.2 shows one button per option and "Something else". `OracleSession` stores the ask as free text (`waiting_on`) and the only existing action is opening the session (`remote_url`). Slice 1 shows the ask, "Open the session", "Not now" and "This matters more". Structured options need machine-side work (later, with Slice 4's answer-in-place).
10. No bulk approve. `PATCH /api/tasks/bulk` accepts only `due_date` and `assignee_id` (`app/app/api/tasks/bulk/route.ts` line 10). "Approve all" loops the single-task PATCH.
11. Task belongs to one arc. `Task.arc_id` is a single column, so "Add to arc" on a task in another arc would move it. Slice 1 avoids this by keeping edits in home records (question 2).
12. Plate size. The design counts 473 open tasks for Mike; live there are 197 in not started, in progress, blocked or review. Whether the approved cleanups (b1, b2) ran is not verified; the screen does not depend on it.
13. Dismissing a thread clears its draft marker. The email-ask PATCH clears `draft_started_at` and `draft_url` when an ask leaves `open`; an undo back to `open` does not restore them until the classifier's next pass.

Risks:
- A push to `main` deploys. Mitigation: the branch is never merged without Mike's word; H11 proves the migration applies to a clean database with no drift.
- The Overlook for everyone now waits for the preferences query before rendering. It is the same cached query `ThemeProvider` already runs; on error or slowness the Overlook renders as before. H10's tests cover all three cases.
- `useSearchParams` in a client page needs a Suspense boundary or `next build` can fail; H10 wraps it and H11 runs the build.
- A write on GET (`home_day` on the first load of the day) can race between two tabs. The unique (user, date) key plus the `P2002` catch makes the second request re-read, the same pattern as rollover.
- First open will be busy. Expected from tonight's data (not exact): Needs you now holds the Claude sign-in, the Grok flag (once tagged), the jillscafe down mail and the WPMU ticket mail, and the Griswold session ask (severity `client_blocking`, though Mike says the cleanup is done; "Not an emergency" clears it); client emails waiting about 11. Each clears in one tap.
- Wrong ranking is the main product risk. The rules are named constants with tests, the tonight fixture pins the expected first screen, and V1 reviews it cold.

Open questions, each with a recommended answer so a yes settles it:
1. Rollout: after a green deploy, may Bast flip only Mike's `home_view` to `home` with one PATCH as Mike, and flip it back the same way if anything looks wrong? Recommended: yes.
2. Arc edits in Slice 1 change only the home screen's own records (the day's steps, his add and remove marks), not `Task.arc_id`, so the Seeing Stone's arc board stays as it is. Real `Arc` records for proposed groups, and syncing his edits into them, come with the keeper in Slice 2. Recommended: yes.
3. Tag the Grok security task (`7aa4a01a`) with `security` through the existing task PATCH before turning the screen on, so it is an emergency and makes Grok the day's arc as in the preview. Recommended: yes.
4. People tiles show known-person threads whose newest open ask is 21 days old or less; older open threads are counted in Everything else as "older open threads" until the owed-reply keeper (Slice 4) replaces this rule. Meeting requests from people with no client link and no draft wait for the meeting lane. Recommended: yes.
5. Hard dates in Slice 1 come only from `promised_to` or `job-watch`/`lifeline` tags. The AEE renewal (November 15) has neither, so it shows elapsed time and no chip until Slice 2 records hard dates with a source. Recommended: yes, and if Mike wants the AEE chip now, Bast sets `promised_to` on that task to "aee-socal.org renewal".
6. "Let it go" on the third "Not now" sets the task to `abandoned` (Mike's own task, through the existing PATCH). Recommended: yes.
7. Builders may start now on H0 to H12; none of questions 1 to 6 blocks them (they change constants or rollout steps only). Recommended: yes.

## 7. Acceptance list for the verifier

Executed checks (all from `A`, each must exit 0 unless stated):
1. `npx prisma validate`.
2. Fresh `postgres:16-alpine` on port 55433, `DATABASE_URL=postgresql://citadel:citadel@localhost:55433/migcheck npx prisma migrate deploy`, then `npx prisma migrate diff --from-url <that url> --to-schema-datamodel prisma/schema.prisma --exit-code` (exit 0 means no drift). Stop the container after.
3. `npx tsc --noEmit`: no error that is not in H0's baseline.
4. The H11 step 3 vitest list: all pass.
5. `npx vitest run` (whole unit suite): no new failing file against H0's baseline.
6. eslint on every added or modified `.ts` and `.tsx` file: 0 errors.
7. `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build`.
8. `git -C W diff --name-only origin/main`: only files owned in section 2's table.
9. `git -C W diff origin/main -- app/components/domain/dashboard app/components/layout app/app/globals.css app/app/api/waiting-on-me app/app/api/today app/app/api/dashboard "app/app/(app)/oracle"` prints nothing.
10. Specific assertions inside the suites, confirmed by reading the test names in the run log: `/api/home` 403 for admin with overlook and for non-admin; preference PATCH `home` 403 for pm and tech; dashboard renders Overlook for overlook, missing and error; tonight fixture puts the Grok arc in Today and keeps collectiveyouth out; copy guard finds no em or en dash; no-red guard passes; token contrast at 4.5:1 or better in all themes.
11. Read-only check of constants against production: `GET /api/clients` with Mike's token, confirm which client names the ventures list (Saiph, KNT, Kava News, Zorp, Schoolhouse) and the noise list (Balloon Guild, Cygal, Word of Life) actually match. Report mismatches; do not change data.

By eye, on a local dev server against the H12 fixture database (`DATABASE_URL=postgresql://citadel:citadel@localhost:55433/migcheck npx next dev -p 3100`, sign in as the fixture admin):

At 1920 by 1080:
- Everything is in one view without scrolling: date line, tile strip, list on the left, card on the right.
- Today is selected on load, with the first arc step open in the card.
- Tile order and labels match the preview; zero tiles look muted; Needs you now uses the muted gold only, no red anywhere.
- Tab title reads "Citadel" with no number; no eyebrow labels; no priority label, score or due date except a real hard-date chip.
- Every row reads cold: a bold statement, a muted second line with who and age, at most 3 buttons plus More.
- The card follows the 2B order, with "Done when" only for more than one deliverable and links as named links.
- Not now removes the row and leaves an Undo; This matters more moves it to the top of its list; nothing else reorders.
- Add a task to the arc by search, add a new one-line task, remove a step, drag a step: the order holds after reload, and the size line updates.
- Swap shows two choices with reasons; Lighter changes the arc; both hold after reload.
- I'll do it now pins the item and collapses the other lists to one line; a second pin asks "Switch to this one?".
- `/dashboard?view=overlook` shows the normal Overlook.
- Repeat in light, dim and dark themes.

At phone width (390 px):
- Tiles wrap with no sideways page scroll; Today spans one column at 420 px and below.
- List and card stack; buttons stay tappable and wrap.

After Mike says deploy and the switch is on (production, by eye, Mike's account only):
- Mike lands on the home screen from `/` and from login.
- Every other user still has `home_view` overlook (H10's tests prove what that renders). Ask Sabeen to confirm on her next login that her Overlook looks the same; nobody signs in as her.
- Write down what the first screen showed against the expectations in section 6, for the two-week review the design asks for.
