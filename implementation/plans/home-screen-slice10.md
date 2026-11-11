# Build plan: Mike's home screen, Slice 10 (today's calendar on the Today view)

I changed nothing while writing this plan. I checked it against:
- Citadel at `f021d6e`, the local read-only checkout. Builders must branch from a fresh `origin/main`.
- `specs/home-slices-7-8-plan.md`, the format and section 0 (8a drawer pattern).
- `specs/home-slices-4-6-plan.md`, 4d.
- `design/home-screen.md` sections 1, 2C and 3.1.
- The last ten sections of `DECISIONS.md`.
- The live code:
  - `lib/home/**`, `HomeScreen.tsx`, `TodayList.tsx`, `HomeProjectDrawer.tsx`
  - `app/api/home/projects/[id]`, `app/api/oracle/calendar-sync`, `app/api/today/calendar`
  - The Seeing Stone's `CalendarEventPopover`
  - `lib/bast-chat/route-helpers.ts` (`ownerToday`)
  - The schema for `CalendarEvent`, `Client`, `ClientContact`, `Site`, `Domain`, `Project`, `ResourceLink`, `ClientReport`, `Accord`, `Meeting`, `EmailAsk`, `HomeOwedThread` and `User`
- The machine: `~/.claude/tools/oracle/clarity/calendar-sync.py`, its crontab line, the summary lines of its local log (counts only), `owed-reply/booker.py`, and the chat daemon's `src/tools/reads.ts`.
- No production reads.

**The owner's binding change (2026-11-11), applied throughout.**
- A row on the home screen is only the time and who the meeting is with.
- Everything else sits behind a click, in a peek drawer on the right (the 8a pattern): title, Join, attendees, projects, his items, the latest thread, report links, the deal and prep hints.
- The drawer loads on open from its own GET, so the main load stays light.

**Facts from the code that shape this plan**
1. **The sync already stores what v1 needs.** `CalendarEvent` holds:
   - `title`, `starts_at`, `ends_at`, `all_day`
   - `description` (cut to 5,000 characters by the script)
   - `meet_url`: Google's `hangoutLink`, else the first video `conferenceData` entry point
   - `location`
   - `attendees` as JSON: `[{email, display_name, response_status, organizer, self}]`
   - The machine script `calendar-sync.py` runs every 15 minutes, 06:00 to 22:45. It reads `mike@becomeindelible.com` through the bast account, skips cancelled and spam events, and covers today's midnight to now plus 7 days.
   - **Not stored:** `transparency` (free or busy), `eventType` (working location, out of office, focus time), `visibility`, `htmlLink`, organizer email (unless there are guests), and other calendars (family, whoismikedion). So v1 ships with no sync change, and 10b is a later, optional sync addition.
2. **`CalendarEvent` has no `user_id`.** It is one calendar, Mike's.
   - The bast-chat owner seed migration (`20261110030000`) shows his Citadel user email is `mike@becomeindelible.com`. That is the same address as the sync's `CALENDAR_ID` and 4d's `BOOK_ACCOUNT`.
   - So "only his own calendar" becomes a check: the session user's email equals that address. Today `requireHomeUser` alone would show the calendar to any admin with `home_view = home`.
3. **A typical day is light.** The last sync lines post 10 events for the whole 7-day window, so 1 to 3 a day. Caps rarely bite.
4. **The home loader already reads today's events** (`load.ts` `loadCalendarEvents`: id, title, times, all_day, no user filter). `today.ts` `freeMinutes` uses them for the size line and ignores all-day events.
   - The two-meetings lighter-arc rule (7e) is not on main yet.
   - This slice changes neither, and exports one predicate, `isMeeting`, for 7e to use (section "Interaction").
5. **All-day rows are stored as UTC midnight dates.** The loader's overlap query (`starts_at < end && ends_at > start` in New York bounds) catches tomorrow's all-day event between 00:00Z and 05:00Z. That is harmless for free time, but the strip must compare all-day events by date string, not by instant. A bug of the same kind exists in `/api/today/calendar`: today's all-day events are left off the Seeing Stone. It is noted here and not fixed in this slice.
6. **Direct links already exist.**
   - `EmailAsk.calendar_event_id` ties a thread to the event it set up.
   - `HomeOwedThread.booked_event_id` ties a 4d "Answer {name}" block to its thread.
7. **There is no "intelligence report" field anywhere.** What is stored:
   - `ResourceLink` rows on a project (name, url, icon)
   - `Client.drive_folder_id` and `Project.drive_folder_id`
   - `ClientReport` (portal monthly reports, url, published_at)
   - `Meeting` (past meeting records: summary, transcript_url, recording_url, client_id)
   - `Accord.record_dir`, which is a disk path, not a link
   - Clients have no stored link list.
8. **The Seeing Stone already has a calendar popover** with https-only Join and linkified descriptions. Its `formatMeetingRange` contains an en dash and it lives under `components/domain/oracle`, so it is not reused. The new code writes its own small helpers.
9. **The chat reads Today through `GET /api/bast-chat/worker/today`** (`ownerToday`, which already loads `raw` and `sel`) and the daemon's `shapeToday`. Adding one `calendar` field needs no new route, lane scope or tool.
10. **Helpers to reuse:** `isFreeMailDomain`, `isOwnDomain`, `normalizeHost` and `emailDomain` from `lib/home/emergency/rule.ts`; `bookWhen`'s clock style ("2:00"); `HomeProjectDrawer`'s drawer primitives; `EXCLUDED_PROJECT_STATUSES` from `rules.ts`.

## 0. Rules for every builder
Section 0 of `home-slices-7-8-plan.md` applies word for word, with these values:
- **Worktree:** `/home/mike/.openclaw/workspace/citadel-home10a-wt` on branch `feat/home-slice10a`. `W` is the worktree and `A` is `W/app`.
- **Scratch database:** `home_s10a_int`, then `_int2` and so on for reruns, on `citadel-home-mig-check` at `localhost:55433`. Each integration file runs alone on a clean database. Leave the container running.
- **New logic lives in `app/lib/home/calendar/`.**
  - Shared files are not touched except by the one wire-in task, CA8 (W), which edits only `HomeScreen.tsx` and its test.
  - Hands off, entirely: `select.ts`, `types.ts`, `load.ts`, `act.ts`, `state.ts`, `today.ts`, `copy.ts` and `ItemCard.tsx`.
  - CA8 starts only after every home branch in flight that touches `HomeScreen.tsx` has merged (session-card Clear, snooze and do it on a day, 9a), then runs `git -C W fetch origin && git -C W rebase origin/main`.
- **No model call. No writes:** the routes are GET only. No schema change in 10a.
- **Screen text:** plain words, no em or en dash, never "priority", "priorities" or "overdue". Event titles and names pass through `plain()`, which turns dashes into commas.
- **Models:** Sonnet medium for implementation, Haiku low for setup and registry. No Opus or Fable builders. No attack round (owner-only tool).

---

## SLICE 10a: today's calendar, rows on the Today view and a meeting drawer

### What Mike sees

**Where it sits.** On the Today tile, in the left pane, at the very top: above "Quick, before you start", which stays above "Today's arc". It uses the same small group heading style, "On your calendar". The tile strip, the date line and other tiles are unchanged.

**Rows: the time and who, nothing else.** For example, at 11:40 on a Wednesday:

```
ON YOUR CALENDAR
1 earlier today
Now     Morgan and Dan, VT Standard
2:00    Erick, Bootleggers (lead)
3:00    Your time to answer Jessica           (muted)
3:30    Boys to Robotics, until 6:00          (muted, not clickable)
All day: Home                                 (muted)
```

How each kind of row reads:
- **A client call.** Attendees matched to `ClientContact` rows: "Morgan and Dan, VT Standard". Three or more people read "Morgan, Dan and 2 more, VT Standard".
- **A lead.** For example, the lane-booked "Erick Bootleggers and Mike Dion": "Erick, Bootleggers (lead)" through `Accord.lead_email`.
- **Team only:** "Sabeen".
- **Nobody matched:** the attendee's display name ("Kue"), else the address's local part and domain ("jessica, hartfordarts.org"). A full address never appears on the row.
- **His own blocks** (no other attendee and no client match, such as "Boys to Robotics"): the title in muted text, with "until 6:00" when longer than 90 minutes. Not clickable.
- **A 4d booked block:** "Your time to answer Jessica", muted, clickable.
- **Times:** "2:00" on the 12-hour clock with no am or pm between 7:00 and 18:59; "6:30 am" and "8:00 pm" outside that. A meeting under way reads "Now".

**Collapsing and caps.**
- Ended events fold into "1 earlier today" (a toggle that shows them muted).
- At most 4 upcoming timed rows show; the rest fold into "2 more later today", also a toggle.

**All-day entries.** One muted line, "All day: Home" or "All day: Home, Veterans Day and 1 more". It shows only when the strip already has a timed or tomorrow row, so a lone "Home" never adds a line.

**Tomorrow.** After 3:00 pm his time, one muted, clickable line: "Tomorrow 1:00  Morgan and Dan, VT Standard". It is the first timed, not-declined meeting tomorrow; personal blocks are skipped.

**When nothing shows.**
- Nothing at all (no heading) when today has no upcoming row and there is no tomorrow line.
- A declined event never shows.

**While an item is pinned (Working on)**, the lists are hidden. One line shows above the pinned card only when a meeting (not a block) is under way or starts within 30 minutes: "2:00  Erick, Bootleggers", clickable.

**The meeting drawer** opens on a row click from the right, the same component family as 8a. Top to bottom:
1. The client or lead name (small caps), the event title, "Wednesday 2:00 to 2:30", and the location when it is plain text.
2. **Join:** "Join on Google Meet", "Join on Zoom", "Join on Teams" or "Join the call". Only when a link parses (rules below).
3. **With:** one line per attendee, for example "Morgan Ellis, VT Standard", "Dan Price, VT Standard, has not replied", "Sabeen, team". It shows the name, else the address (his own session only). Below it, a muted line on how the match was made, for example "Matched by Morgan's email address." When nothing matched: "No client or lead matched this meeting."
4. **Before the call**, at most 3 real hints, each only when its source exists:
   - "You owe Morgan a reply: Re: memorial page timing."
   - "Decide before the call: 3 questions from the Phil Camp session."
   - "A sign-off waits on you for Phil Camp memorial page."
   - "Security on griswoldcontrols.com needs you now." (an emergency item for that client)
   - "You set aside a reply to Morgan until Friday." (a parked thread from an attendee; muted; the item is not changed)
5. **Your items for VT Standard:** up to 3 of his in-view, not-parked items for that client or its live projects or from an attendee, rendered with the main list's own card and buttons (`renderItem`, as in 8a). Then "and 2 more", which opens the project drawer when they all sit in one project.
6. **Links**, up to 6 in this order:
   - each live project, up to 2 (opens the 8a drawer in place of this one)
   - "Last email: Wednesday, November 11, Morgan: Tomorrow works" (the thread's deep link)
   - report links (rules below)
   - "Notes from the last meeting, October 28"
   - "The deal: Bootleggers site" (`/deals/{id}`) for a lead
   - "Open VT Standard" (`/clients/{id}`)
7. **From the invite:** the description as plain text, tags removed, cut to 600 characters, muted. Links inside it are anchors only for known meeting hosts; any other URL stays plain text.

**Nothing on the row or in the drawer acts.** Meeting rows are not items: no Not now, no ranking, no keeper, no learning, no `home_actions`. The only buttons that do anything are the existing item cards inside the drawer, unchanged.

### Rules (pure, `lib/home/calendar/`)

**Which events (`classify.ts`)**
- Today's events:
  - Timed events overlapping his zoned day.
  - All-day events whose stored start date (UTC date part) ≤ today's zoned date < end date. This is the fix for fact 5.
- Tomorrow's events: the same test for tomorrow's date, timed only.
- `others(event)`: attendees minus himself (`self` true, or the address equals `CALENDAR_OWNER_EMAIL`), minus resource calendars (`@resource.calendar.google.com`) and group calendars (`@group.calendar.google.com`).
- Declined: his own attendee entry has `response_status === 'declined'`. Hidden everywhere.
- Kinds:
  - `answer`: `event_id` equals one of his `HomeOwedThread.booked_event_id`.
  - `meeting`: there is at least one other attendee, or a title match.
  - `block`: anything else.
- `isMeeting(event)` (exported for 7e): timed, not declined, kind `meeting`.
- Rows:
  - Ended (`ends_at ≤ now`) go to `earlier`.
  - Started and not ended show as "Now".
  - Upcoming are ordered by start, the first 4 shown and the rest in `later`.
  - All-day events go to the all-day line.
- Tomorrow line only when `now` is at or after 15:00 in his zone.

**Who it is with (`match.ts`), checked in this order for each other attendee's lowercased address:**
1. **Team:** an active `User` with that email, or any own-domain address (`isOwnDomain`). Label: first name. Team members never make a client.
2. **Contact:** `ClientContact.email` (not deleted, client not deleted).
   - If one address is a contact at several clients, the order is: a client with a live project (`ready`, `in_progress`, `review`), then the client of the newest `EmailAsk` from that address, then client name A to Z.
3. **Lead:** `Accord.lead_email` (not deleted, status `lead`, `meeting`, `proposal` or `contract`), newest `updated_at`. Label: lead first name plus ", {lead_business_name} (lead)".
4. **Domain:** the address's domain must not be free mail or own. Match if `Domain.name` equals it, or a `Site.url` host (`normalizeHost`) equals it, or another `ClientContact` sits at the same domain. If two clients claim the domain, there is no domain match.
5. **Otherwise unmatched:** display name first word, else local part plus ", {domain}" (no domain for free mail).

**Strongest link, before any of the above:** an `EmailAsk` with `calendar_event_id = event.event_id` and a `client_id`. That client is primary, and its thread is "the email that set up this meeting".

**Title match**, only when no attendee matched a client or lead:
- Word-boundary, case-insensitive search of live project names, then active client names, 4 characters or more, minus a stoplist ("Home", "Call", "Meeting", "Lunch", "Indelible").
- Exactly one hit, or no match at all. A project hit gives its client.

**Primary client:**
- Most matched attendees, then a live project, then a title mention, then name A to Z.
- Other matched clients go to "Also with: Nerd Herd" in the drawer. Their context is not loaded.

**Labels:**
- The primary client's people first (up to 2 first names, then "and N more"), then ", {client}".
- A lead row ends "(lead)".
- Team names are added only when nobody else is in the meeting.

**A wrong match is cheap.** It changes one label and some links. The drawer always says how it matched.

**Join link (`join.ts`)**
1. `meet_url`, if it parses with `new URL()`, protocol `https:`, and has no user or password.
2. Else the first such URL in `location`, then in `description`, on a known host:
   - `meet.google.com`
   - `zoom.us` and `*.zoom.us`
   - `teams.microsoft.com`, `teams.live.com`
   - `*.webex.com`
   - `whereby.com`
3. Else none. `javascript:`, `data:`, `http:` and lookalike hosts (`zoom.us.evil.com`) never pass. Tests cover each.

**Description (`copy.ts` `inviteText`)**
- Remove tags, decode the 6 common entities, collapse whitespace, cut to 600 characters on a word.
- Rendered as React text only, never as HTML.
- Anchors only for URLs that pass the Join host test.

**Report links (`drawer.ts`)**
- The client's `ResourceLink` rows on its live projects, and on projects done in the last 180 days, whose name matches `report|audit|intel|intelligence|microsite|strategy|roadmap|swot|proposal|growth plan`. Newest first, at most 2, labeled with their own name.
- Then the latest published `ClientReport`: "Monthly report, October".
- Then a Drive folder (project, else client): "Drive folder", linked to `https://drive.google.com/drive/folders/{id}`.
- The URL must be https.

**Hints (`drawer.ts`, from the same `selectHome` candidates as 8a, read only)**
- **Owed reply:** a `thread` candidate in view and not parked, whose asks' `from_email` is an attendee. Uses the newest ask's subject.
- **Session questions:** in-view `session` candidates whose client is the primary client, counted per session title. With no title: "from a Bast session".
- **Sign-off:** an in-view `review` candidate on a live project of the client.
- **Needs you now:** an emergency candidate for the client.
- **Set aside:** a parked thread from an attendee. One muted line, and the item is not touched.

**Items in the drawer**
- Candidates in view and not parked, where the client matches, or the project is one of the client's live projects, or the thread is from an attendee.
- Excludes `hands`, `step` and review pieces, as 8a does.
- Ordered by 8a's own order (exported from `projects/drawer.ts`, no behaviour change). Capped at 3.

**Interaction with what exists**
- **The size line and free minutes are unchanged.** Personal blocks still reduce free time, as today.
- **7e's two-meetings rule** should count `isMeeting` events (a long "Boys to Robotics" is not a meeting). That is a note for 7e's DY1/DY2. 10a does not change `today.ts`.
- **4d blocks** show as his own muted rows. Their drawer holds "Open the thread" and the thread's card if it is in view.
- **Snoozed and on-day items are not changed, counted or ranked.** Only the one muted "set aside" line mentions them.

### Schema
None.

### Routes
- **`GET /api/home/calendar`**
  - Gate: `requireCalendarOwner()` = `requireHomeUser()` plus the session user's email equals `CALENDAR_OWNER_EMAIL`, else 403. No user id parameter. `Cache-Control: no-store`. Writes nothing.
  - It does not call `loadHomeInputs` or `selectHome`, and never writes `home_day`.
  - Reads: events for today and tomorrow, his `booked_event_id` values, then the match tables for the addresses, domains and title in those events (users, contacts, accords, domains, sites, live project names, client names, and asks by `calendar_event_id`).
  - Response:
    ```ts
    interface HomeCalendarRow { id: string /* CalendarEvent.id */; time: string; who: string; muted: boolean; openable: boolean }
    interface HomeCalendarStrip { upcoming: HomeCalendarRow[]; later: HomeCalendarRow[]; earlier: HomeCalendarRow[]; all_day: string | null; tomorrow: HomeCalendarRow | null; soon: HomeCalendarRow | null /* for the pinned line */ }
    ```
- **`GET /api/home/calendar/[id]`**
  - Same gate. `id` must be a uuid of an event overlapping today or tomorrow, else 404. Writes nothing.
  - Runs `loadHomeInputs`, `loadItemStates` and `selectHome` (exactly as `/api/home/projects/[id]`), plus the context reads: live projects, resource links, client report, newest `EmailAsk` from an attendee (else for the client), accord, newest `Meeting` for the client with a summary or transcript, and Drive folder ids.
  - Response:
    ```ts
    interface HomeCalendarEventResponse {
      event: { id: string; title: string; when: string; location: string | null; join: { href: string; label: string } | null; invite_text: string | null; invite_links: { href: string; label: string }[] };
      client: HomeRef | null; also_with: string[];
      people: { name: string; detail: string | null; reply: string | null }[];
      matched_by: string;
      hints: { text: string; muted: boolean }[];
      items: HomeProjectItem[]; more_items: number; more_project_id: string | null;
      links: { label: string; href: string | null; project_id: string | null }[];
    }
    ```
- **Chat, no new route:** `ownerToday` gains:
  ```
  calendar: { rows: [{start, end, all_day, who, title, kind, join_url|null, client|null, lead:boolean}], tomorrow_first: row|null }
  ```
  - Names only, never an email or the description.
  - Empty when the owner's email is not the calendar's.

### Task list, 10a

| Id | What | Files it owns | Depends on | Model |
|---|---|---|---|---|
| CA0 | Worktree, `npm ci`, baseline (tsc, whole vitest), plan copy | `W/implementation/plans/home-screen-slice10.md` | none | Haiku low |
| CA1 | Pure core and shapes | new `app/lib/home/calendar/types.ts` (strip, drawer, chat shapes), `rules.ts` (`CALENDAR_OWNER_EMAIL`, `MEETING_HOSTS`, `CAL` caps: upcoming 4, tomorrowHour 15, soonMinutes 30, longBlockMinutes 90, inviteChars 600, items 3, hints 3, links 6, titleMin 4, stoplist, report-name pattern), `classify.ts`, `join.ts`, `copy.ts`, `strip.ts`; tests `calendar/__tests__/classify.test.ts`, `join.test.ts`, `copy.test.ts`, `strip.test.ts` | CA0 | Sonnet medium |
| CA2 | Matching and strip reads | new `calendar/match.ts` (pure), `calendar/load.ts` (`loadCalendarDays`, `loadMatchTables`, `loadBookedEventIds`), `calendar/gate.ts` (`requireCalendarOwner`); tests `match.test.ts`, `load.test.ts` (mocked prisma), `gate.test.ts` | CA1 | Sonnet medium |
| CA3 | Drawer core | new `calendar/drawer.ts` (pure: hints, items, links from candidates and context), `calendar/context.ts` (the drawer's context reads); `app/lib/home/projects/drawer.ts` (export `whereOf` and `drawerCompare`, no behaviour change); tests `drawer.test.ts`, `context.test.ts`, existing `projects/__tests__/drawer*.test.ts` unchanged and green | CA2 | Sonnet medium |
| CA4 | Routes | new `app/app/api/home/calendar/route.ts`, `app/app/api/home/calendar/[id]/route.ts`; tests in each folder's `__tests__/route.test.ts` | CA2, CA3 | Sonnet medium |
| CA5 | UI and hooks | new `app/components/domain/home/CalendarStrip.tsx`, `CalendarDrawer.tsx`, new `app/lib/hooks/use-home-calendar.ts` (`useHomeCalendar`, `useHomeCalendarEvent`); tests `components/domain/home/__tests__/CalendarStrip.test.tsx`, `CalendarDrawer.test.tsx`, `lib/hooks/__tests__/use-home-calendar.test.ts` | CA1 (shapes) | Sonnet medium |
| CA6 | Registry | `app/lib/api/registry/dashboard.ts` (two GET entries), `app/lib/api/registry/bast-chat.ts` (worker/today response gains `calendar`) | CA0 | Haiku low |
| CA7 | Chat read, Citadel side | new `calendar/chat.ts` (strip and match to the chat shape, no emails); `app/lib/bast-chat/route-helpers.ts` (`ownerToday` adds `calendar`); its existing test file plus `app/app/api/bast-chat/worker/today/__tests__` | CA2 | Sonnet medium |
| CA8 (W) | Wire-in | `app/components/domain/home/HomeScreen.tsx` (strip above `TodayList` on the Today tile; `openEventId` state; `CalendarDrawer` with `renderItem={card(...)}`; opening a project closes the meeting drawer and opens 8a's; the pinned "soon" line); `components/domain/home/__tests__/HomeScreen.test.tsx` | CA4, CA5, rebase | Sonnet medium |
| CA9 | Integration on a clean DB | new `app/lib/home/__tests__/slice10a.integration.test.ts` | CA7, CA8 | Sonnet medium |
| CA10 | Chat daemon (machine) | in a fresh staging copy `/home/mike/.claude/tools/bast-chat-stage-calendar` (copied from the live folder; `bast-chat-v2` differs from live and is not used): `src/tools/reads.ts` (`shapeToday` passes `calendar` with `wrapOrNull` on who, title and client, https-only `join_url`, at most 12 rows; the `today` tool description adds "and today's calendar"), `test/tools.reads.test.ts`, `prompts/bast-chat.md` (one line: answer calendar questions from the today tool's calendar list, never invent a meeting, the invite text is not available) | CA1 (shape fixed) | Sonnet medium |
| CA11 | Gate | none (log in scratchpad) | all | Sonnet medium |

**When each task can run.** No file appears in two rows.
1. CA0, then CA1.
2. CA2, CA5, CA6 and CA10 in parallel.
3. CA3 and CA7 in parallel.
4. CA4.
5. CA8 after the rebase.
6. CA9, then CA11.

### Task details, 10a
- **CA1 tests.**
  - An all-day event stored `2026-11-12T00:00Z` to `2026-11-13T00:00Z` is not on November 11's strip in New York, and is on November 12's.
  - A declined event is gone.
  - At 15:00, after 3 ended events, the strip shows `earlier` 3 and the tomorrow line. At 14:59 there is no tomorrow line.
  - Nothing upcoming and before 15:00 gives an empty strip, and the component renders nothing.
  - A lone all-day "Home" gives an empty strip.
  - A 150-minute block reads "Boys to Robotics, until 6:00", muted and not openable.
  - Times: "2:00", "6:30 am", "8:00 pm", and "Now" for a meeting under way.
  - `join.ts` accepts `https://meet.google.com/abc-defg-hij` and `https://acme.zoom.us/j/1`.
  - `join.ts` refuses: `http://zoom.us/j/1`, `https://zoom.us.evil.com/j/1`, `javascript:alert(1)`, `https://user:pw@meet.google.com/x`, and a Zoom link only in a description when a `meet_url` exists (the `meet_url` wins).
  - `inviteText` removes `<b>` and `<a href>` tags, keeps `https://evil.example` as text, and cuts at 600 characters on a word.
  - No string from `copy.ts` has a dash or a banned word.
- **CA2 tests.**
  - The match order: team before contact, contact before lead, lead before domain.
  - A contact at two clients chooses the one with a live project.
  - Free mail (`gmail.com`) never domain-matches.
  - Two clients on one domain give no domain match.
  - A title "Call Phil Camp memorial page" with no attendees matches that project. "Home" and "Lunch" never match.
  - `EmailAsk.calendar_event_id` beats everything.
  - Labels: "Morgan and Dan, VT Standard", "Morgan, Dan and 2 more, VT Standard", "Erick, Bootleggers (lead)", "Sabeen", "jessica, hartfordarts.org", "Kue".
  - No label contains "@".
  - `gate.test.ts`: an API key gets 403, a tech user 403, an overlook admin 403, and an admin with `home_view` home but another email 403. Mike passes.
- **CA3 tests.**
  - An owed thread from an attendee gives "You owe Morgan a reply: ...".
  - A parked one gives only the muted "set aside" line, and its state row is unchanged.
  - Two session asks under the Phil Camp session for VT Standard give "Decide before the call: 2 questions from the Phil Camp session."
  - No source, no hint.
  - Items:
    - another client's item never appears
    - a parked item never appears
    - 5 items give 3 plus `more_items` 2
    - `more_project_id` is set only when all 5 share one project
  - Report links: "Intelligence report" and "Website audit" `ResourceLink` rows qualify; "Figma" does not; an `http:` link is dropped.
  - The 8a drawer tests are unchanged and green.
- **CA4 tests.**
  - The gate cases.
  - The strip route never calls `loadHomeInputs` (spy).
  - Neither route writes (the mocked prisma asserts no create, update, upsert or delete).
  - The drawer 404s on a bad uuid and on an event 3 days out.
  - `Cache-Control: no-store`.
- **CA5.**
  - The strip uses the Today group heading style and returns null when empty.
  - Rows are buttons only when `openable`; muted rows use `--text-muted`.
  - The "earlier" and "later" toggles are `aria-expanded`.
  - The drawer reuses `components/ui/drawer` (side right, size lg), shows loading, failed ("The meeting did not load. Nothing was changed." plus "Try again") and loaded states, and opens Join, report and email links in a new tab with `rel="noopener noreferrer"`.
  - Hooks:
    - Keys under `HOME_KEYS.all`, so an item action refreshes them.
    - The strip: `staleTime` 10 minutes, refetch on window focus only when stale.
    - The drawer: `staleTime: Infinity`, `gcTime: 0`, as 8a.
- **CA7 test.**
  - `ownerToday` output gains `calendar`, with no "@" anywhere inside it.
  - The existing fields are deep-equal to before.
- **CA8.**
  - `HomeScreen.test.tsx`: the strip renders above "Quick, before you start" on Today and not on other tiles.
  - Clicking a row opens the drawer. The drawer's project link closes it and opens `HomeProjectDrawer`.
  - The pinned "soon" line appears only with `soon` set.
  - No other component changes.
- **CA9** asserts, on a fresh DB with fixtures made in the test, at a fixed `now` of Wednesday November 11 at 11:40 and again at 15:10 New York:
  - **Fixtures:**
    - Owner `mike@becomeindelible.com` (admin, `home_view` home, zone New York)
    - Sabeen
    - VT Standard with contacts Morgan and Dan, a live project "Phil Camp memorial page" with a `ResourceLink` "Intelligence report" and one named "Figma"
    - Bootleggers as a lead accord with `lead_email`
    - Events:
      - VT call 11:30 to 12:00 with `meet_url`
      - Erick 14:00, with a description holding `<b>` and an outside link
      - "Answer Jessica" 15:00 with a matching `booked_event_id`
      - "Boys to Robotics" 15:30 to 18:00 with no attendees
      - all-day "Home" today
      - an all-day event tomorrow
      - a declined 16:00
      - Morgan tomorrow at 13:00
    - An open thread from Morgan, and a task of his for VT Standard
    - A task of another user's for VT Standard
  - **Checks:**
    - The strip rows and labels at both times.
    - The drawer for the VT call: Join on Google Meet, the project link, the Intelligence report link (not Figma), the owed-reply hint, his task card present, the other user's task absent.
    - The Erick drawer: the deal link, and the outside link as plain text.
    - 403 for a tech user, an overlook admin and a second home admin.
    - Row counts and `updated_at` unchanged on `tasks`, `email_asks`, `waits`, `projects`, `calendar_events`, `home_item_state`, `home_actions` and `home_day`.
- **CA10 tests** (node test runner):
  - A `calendar` payload with a hostile title comes back wrapped.
  - An `http:` or `javascript:` `join_url` becomes null.
  - A missing `calendar` gives `[]`.
  - The tool count is still 23.
  - `npm --prefix STAGE test` and `npm --prefix STAGE run typecheck` exit 0.
- **CA11 gate** (exit codes decide):
  1. tsc with no error beyond the CA0 baseline.
  2. `npx vitest run lib/home components/domain/home app/api/home app/api/bast-chat lib/bast-chat lib/hooks/__tests__/use-home-calendar.test.ts lib/api/registry/__tests__/registry.test.ts app/api/docs/__tests__/route.test.ts "app/(app)/dashboard/__tests__/page.test.tsx"`.
  3. Whole suite: no new failing file against the baseline.
  4. eslint on changed files.
  5. `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build`.
  6. CA9 alone on a fresh `home_s10a_int`: `docker exec citadel-home-mig-check psql -U citadel -d postgres -c 'CREATE DATABASE home_s10a_int'`, then `migrate deploy`, then that one file.
  7. By eye: `next dev -p 3100` against a scratch DB seeded by CA9's fixture builder run once, showing the strip and both drawers.
  8. No schema: `git -C W diff --name-only origin/main -- app/prisma` prints nothing.
  9. Allowed files: `git -C W diff --name-only origin/main` lists only the table's files.
  10. Untouched: `git -C W diff origin/main -- app/lib/home/select.ts app/lib/home/types.ts app/lib/home/load.ts app/lib/home/act.ts app/lib/home/state.ts app/lib/home/today.ts app/lib/home/copy.ts app/components/domain/home/ItemCard.tsx app/components/domain/oracle app/app/api/oracle app/app/api/today app/lib/oracle app/components/layout app/app/globals.css` prints nothing.
  11. `grep -rnE '—|–|[Pp]riorit|[Oo]verdue' app/lib/home/calendar app/components/domain/home/Calendar*.tsx` (outside comments) and the CA10 staging diff both print nothing.
  12. The CA10 daemon tests and typecheck exit 0.
  13. Commit only when 1 to 12 pass.

### Deploy, 10a
1. Push and merge to `main` (standing "push to citadel"). `gh run watch` until green.
2. Production, GET only: one `GET /api/bast-chat/worker/today` with the chat key from `/home/mike/.citadel-bast-chat-token`. It shows `calendar.rows` with no "@" inside. The two session routes are seen by Mike on his own screen.
3. Chat daemon swap, the same procedure as the 2026-11-11 03:00 swap:
   - backup `~/.claude/tools/bast-chat.bak-2026111X-calendar`
   - copy the three changed files from the staging copy into the live folder
   - restart `bast-chat.service` with no conversation open
   - safety check passes, still 23 tools
   - The daemon tolerates a missing `calendar`, so the swap can come before or after the Citadel deploy.
4. No crontab, config or sync change.

### Rollback, 10a
- Revert the merge. There is no schema and no data to undo; the strip and drawer disappear.
- Daemon: restore the backup folder and restart.

---

## SLICE 10b (later, optional): richer sync fields
Ship only after 10a has been in use for a few days, and only on Decision 9.

**Machine script change**, in `calendar-sync.py` `_map_event`, plus its test:
- `transparency` (Google `transparency`, absent means `opaque`)
- `event_type` (`eventType`)
- `html_link` (`htmlLink`, https only)
- `organizer_email` (`organizer.email`)
- `visibility`

**Citadel side:**
- The sync route's zod schema accepts the 5 fields as optional and nullable. Zod already strips unknown keys, so either side can deploy first.
- Migration `20261115050000_home_slice10b`: 5 nullable `VarChar` columns on `calendar_events`.

**Use:**
- Transparent events and `workingLocation` events show muted, or are left off the strip.
- `outOfOffice` reads "Out of office until 2:00".
- The drawer gains "Open in Google Calendar".

Free-time counting of transparent events is a `today.ts` change for its owner, not part of 10b.

---

## Decisions for Mike (builders proceed on each recommendation)
1. **Where the strip sits.** Recommended: at the top of the Today tile's left pane, above "Quick, before you start", and only on Today. The alternative is a line under the date on every tile, which is more clutter.
2. **A heading.** Recommended: "On your calendar", in the same small style as "Quick, before you start", since every Today group has one.
3. **Tomorrow's first meeting after 3 pm, as one muted line.** Recommended: yes.
4. **While an item is pinned, one line for a meeting under way or starting within 30 minutes.** Recommended: yes. It saves him remembering a call while focused.
5. **All-day entries.** Recommended: one muted line, only when a timed or tomorrow row already shows. After 10b, working-location entries such as "Home" leave entirely.
6. **Declined meetings are hidden.** Recommended: yes.
7. **A reply he set aside to someone in the meeting gets one muted drawer line; the item is not changed.** Recommended: yes. That is context, not a nudge.
8. **Description links beyond meeting hosts** (for example Google Docs agendas). Recommended: not in 10a. They show as plain text he can copy. Revisit if he asks.
9. **10b sync fields** (free or busy, working location, Google Calendar link). Recommended: yes, after a few days of 10a.
10. **Syncing the family and whoismikedion calendars.** Recommended: no for now. The blocks he named already sit on `mike@` (assumption, not checked), and the bast account's access to the other calendars is unverified.
11. **A stored link list per client for intelligence reports and microsites.** Recommended: not now. Use project `ResourceLink` rows named for the report. Have Wright and Assayer add one when they publish (a follow-up outside this slice).
12. **Notes from the last meeting** (from `Meeting` rows) in the drawer's links. Recommended: yes.
13. **The chat answers "what's on my calendar today" from the today tool's new calendar list:** names, times, titles and join links, never emails or invite text. Recommended: yes.

## Risks worth naming
- **A match can be wrong** (a shared domain or a contact listed at two clients). It costs one label and some links, and the drawer says how it matched.
- **Personal blocks are inferred** from "no one else invited", because transparency is not stored until 10b. A solo work block titled with a client name will read as that client, which is the right reading.
- **The strip is up to 15 minutes behind Google** (the sync interval), and nothing syncs between 22:45 and 06:00.
- **The drawer runs the full home selection on open**, as 8a does. That is fine for one user. The strip itself stays light.

### Critical Files for Implementation
- /home/mike/.openclaw/workspace/citadel/app/components/domain/home/HomeScreen.tsx
- /home/mike/.openclaw/workspace/citadel/app/app/api/home/projects/[id]/route.ts (the pattern for both new routes)
- /home/mike/.openclaw/workspace/citadel/app/lib/home/projects/drawer.ts
- /home/mike/.openclaw/workspace/citadel/app/lib/bast-chat/route-helpers.ts
- /home/mike/.claude/tools/oracle/clarity/calendar-sync.py (what is stored; 10b only)