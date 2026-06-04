# Troubador Control Plane in Citadel — Design & Data Model

*Status: design + data model, ready to turn into an implementation plan. Supersedes and
consolidates `publishing-troubador-notes.md` (kept for history). Everything here reflects
decisions made in the planning conversation of 2026-06-03.*

*Companion: the original notes file is the "first draft"; this is the agreed design. Where the
two disagree, **this file wins.***

---

## 0. Scope of the first build

- **Board first.** Build the full control plane: schedules → runs → topic selection → research →
  interview → writing → approval → scheduling. The human-facing surfaces and the worker API.
- **Publishing is deferred** to a later phase. It will be handled by the **Bast-machine cron**
  (the same worker), not by Citadel server-side, for now. BUT: we **reserve the Site publish-config
  fields now** (`site_type` + targets) so we don't migrate later when the cron grows teeth.
- **Internal-only.** Clients never log into Citadel in v1. The editor proxies all client
  touchpoints (topic selection, approval) after whatever offline back-and-forth happens.

---

## 1. The shape of it

A **Troubador** section in Citadel is the control plane for content production. The unit that
moves across the board is a **Run** (one content-production cycle for a **client + site**). A Run
contains **Articles** (one per selected topic). **Schedules** spawn Runs on a cadence. A
terminal **Troubador worker** (Claude Code on the Bast machine, fired by cron several times/day)
does all machine work by polling Citadel, doing the work in clean per-item contexts, writing
results back, and advancing state. **Citadel is the source of truth; all worker writes are
upserts.**

Everything ties to existing Citadel entities: every Run (and therefore every Article and
Schedule) is associated with a **Client** and a **Site** — reusing `clients` and `sites`.

```
Schedule (cadence) ──spawns──> Run ──contains──> Article(s)
   │ per client+site              │ per client+site   │
   │ default editor               │ assigned editor   │ own status, own publish date
   └──────────────────────────────┴───────────────────┘
                         Troubador worker drains the queue
```

---

## 2. The board — run-level stages (columns)

The board is the **macro** view: one card per Run, coarse state. Per-article granularity lives
*inside* the card (see §3), never on the board — that's the key decision that makes "ship some,
not all" smooth.

| # | Column (run stage) | Who acts | What happens | Advance trigger |
|---|--------------------|----------|--------------|-----------------|
| 1 | **Planning** | Editor (human) | Run appears here (from a schedule or manual create). Editor writes/refines the **per-run brief** (inherits schedule goals; see §5), then marks ready. | Human sets `ready` |
| 2 | **Topic Selection** | Editor (human) | Worker has posted ~20 proposals. Editor checks topics, adds custom ones, marks ready. | Human sets `selection_ready` |
| 3 | **Researching** | Worker | Researches each selected topic one at a time; writes research per article. | Worker advances when all articles researched |
| 4 | **Ready for Interview** | Editor (human, in CLI) | Worker has posted **consolidated prep questions** to the card (emailed to client as prep). Editor runs the live, dynamic interview in CLI off the Bast machine. | **Troubador skill advances the run itself** on interview completion — not a manual flag |
| 5 | **In Production** | Worker + Editor (per article) | Post-interview, per **article**: drafting → review → approve/revise. The run sits here while any live article is still being written or reviewed. | All live articles approved → Publishing |
| 6 | **Publishing** | Editor + (cron) | All live articles are approved; editor sets/confirms publish dates; the Bast cron publishes each on its date. Visible column so an approved-but-unpublished run doesn't look stalled. | All live articles published/postponed → Done |
| 7 | **Done** | — | terminal | — |

> Stage sync (`lib/troubador/run-stage.ts`): the run auto-moves **in_production → publishing** when no
> live (non-dropped) article is still in a writing/review status, and **→ done** when every live
> article is published or postponed. Reopening an approved article via feedback pulls it back to
> in_production. ("publishing" was added after initial build per the over-collapse of the original
> Scheduling column — see history.)

Plus run lifecycle states off the main flow: **Cancelled** (and Schedules can be Paused — see §5).

> Why "In Production" instead of separate Writing/Approval/Scheduling/Published columns: a run's
> articles move at different speeds (one approved, one in its 2nd revision, one dropped). A single
> card can't honestly sit in four columns at once. So the board shows the run as "In Production"
> and the **card detail** carries the per-article table where the real movement happens.

**Review-needed surfacing (required):** because article-level review is hidden inside the card, the
run card must carry a **badge/count of articles awaiting the editor's review** (`in_review`), and
those same items appear in the **dashboard work queue**. The badge is the at-a-glance "this run
needs you" signal so nothing waits unseen inside a collapsed card.

---

## 3. The Run card detail — the article table

Opening a Run card shows its metadata (client, site, brief, assignee, schedule) and a **table of
articles**, one row each. This is where "move some forward, not all" is a per-row action, not a
drag.

Per row: **status**, **suggested/confirmed publish date**, and actions: **Approve**, **Drop**,
edit date. Opening an article shows:
- the **content** (markdown for Eleventy / HTML for WP),
- all controls (approve / drop / set date),
- inline **edit** of the copy,
- a **feedback area**: a chain of comments, newest on top.

### Article lifecycle (status)

```
pending_research → researched → drafting → in_review → approved → scheduled → published
                                    ↑            │
                                    └──needs_revision  (editor left feedback)
                                  (any) → dropped       (editor removed it from the run, permanent)
                                  (any) → postponed     (editor parked it; reactivatable → backlog)
```

Per-article actions: **Approve · Drop · Postpone** (plus edit copy, set date, leave feedback).

Rules:
- **Troubador never sets `approved`.** It moves `needs_revision → in_review` after a rewrite. The
  `approved` flip is human-only, per article.
- **Postpone vs Drop:** *Drop* is permanent removal (struck-through, frees its date, gone). *Postpone*
  parks a stuck article without killing it — it doesn't block the run reaching Done, the worker stops
  touching it, and it can be **reactivated** (back into its workflow) or **carried into a future run**
  via the client backlog (§5b). Use it when something's stuck (compliance hold, client gone quiet) but
  you don't want to lose the work.
- **Feedback → rewrite loop:** editor comments → article flips `needs_revision` → next worker tick
  rewrites → flips back to `in_review` → **re-appears in the editor's dashboard queue + Bast
  digest.** The comment chain persists as the thread (what was asked vs. what changed).
- **Hand-edit wins:** the Citadel article copy is the **source of truth at publish time**. Once
  `approved`, the rewrite path is **locked** — no worker touches approved copy. At publish the
  worker commits the *approved Citadel copy*, never a regenerated draft.
- **Drop:** dropped articles stay in the table **struck-through** for the record and **free their
  publish date** back to the pool. They stop counting toward run completion.
- **Suggested dates** come from the schedule's publish cadence and **consult the whole site
  publishing calendar** (across all runs) so two articles never land on the same date for the
  same **site** (cross-client same-day is fine; same-site same-day is the collision to prevent).

### Review checks (the 11, run by the worker before review)

Worker writes → runs the checks → **only clean articles reach `in_review`.** A failed check still
surfaces the article to the editor but **flagged with the failure reason** (not presented as
ready). The **compliance check is fail-closed**: a failure **parks the article** (`check_failed`
+ compliance flag) and pings the editor — it does *not* slide into the normal review queue.

---

## 4. Notifications, assignment, dashboard

- Every Run has an **assignee** (the editor). Default = schedule's default editor (or creator for
  manual runs); reassignable per run.
- **Everything needing the editor's action appears in their dashboard** as a work queue — pending
  approvals, runs in Planning/Topic-Selection, articles bounced back from revision — flattened
  across all runs so they work a list, not a board.
- **Bast daily digest mirrors this:** "what's waiting for your Troubador feedback" alongside the
  rest of the day's roundup.
- **Editor "role":** modeled as the **per-run `assignee`**, not (initially) a new global
  `UserRole`. Any user can be assigned. Troubador-section access gated by existing roles. *(Open
  decision §10.1 — add a global `editor` role only if we find we need it.)*

---

## 5. Schedules — turning one Run into a stream

A **Schedule** auto-instantiates Runs on a cadence. Two surfaces, **one underlying object**:
a **Schedules tab** on the Troubador screen and a **Publishing tab** on the Client screen.

A schedule defines:
- **client + site**
- **target article count** (soft target, not a contract)
- **publish cadence** (e.g. 2/week) **and lead time** — next-run timing is *derived*: "when does
  the calendar run dry, minus lead time," **not a fixed drumbeat**. We schedule to *keep the
  calendar full*, so we don't overproduce inventory we can't ship.
- **overarching goals** (default brief the per-run brief inherits and can override)
- **default editor**
- **start date** — the first Run drops into Planning on that date.
- **stack policy flag** (`allow_concurrent`), default **false**. When false and an open run
  exists for the schedule, the scheduler **skips and flags** ("Acme overdue, prior run still
  open") rather than stacking. Set true for the special-campaign case where a meticulous one-off
  shouldn't throttle the everyday stream.
- **lifecycle status**: `active | paused | ended`, plus **skip-once**. Schedules screen defaults
  to **active only**, filterable by client.

Behavior:
- Run instantiation is **Citadel server-side** (it's just inserting a card on a cadence — no
  worker needed). The worker only does the *work*.
- **Never backfill** missed runs (a downed scheduler shouldn't stampede five runs on recovery) —
  fire the next one only.
- New run → editor notified (dashboard + digest).
- Per-run brief is **Planning's** job: schedule seeds the goals; editor refines specifics
  (emphasis, must-cover, avoid) before flipping `ready`. Tie a "revisit schedules" nudge to the
  quarterly review so schedule-level goals don't rot.

### 5b. The client Backlog (carryforward + save-for-later)

A per-client **Backlog** is a single surface holding everything "set aside for a future run." Two
kinds of thing feed it, from the same instinct (don't lose good work):

- **Saved topic proposals** — `TopicProposal.saved_for_later = true`. Unused-but-good ideas from a
  run's ~20 proposals. No content yet.
- **Postponed articles** — `Article.status = postponed`. Stuck mid-production (compliance hold,
  client gone quiet) but the research/draft is worth keeping.

When a new run hits **Topic Selection**, the worker/UI **surfaces the client's backlog first** —
saved topics drop into the proposal pool; postponed articles can be pulled into the run to resume
where they left off (re-parented to the new run). The Backlog is a view (a query over both flags
scoped to `client_id`), not a new table.

---

## 6. The worker loop (Bast-machine cron)

The cron fires several times/day and may find, e.g., 15 articles to write across 3 clients. Safe
because state lives in Citadel and writes are upserts → the worker is a **resumable
queue-drainer**, not a fragile long script.

1. **Pull the work queue** — every Run/Article at a machine-actionable state (proposals-needed,
   research-needed, draft-needed, rewrite-needed; later: publish-due).
2. **Order by urgency** — soonest needed/publish date first, so interruption leaves the
   time-sensitive work done.
3. **Process one unit at a time in a clean sub-agent context** (reuse Troubador's
   Strategist/Writer split). No single mega-session writing 15 articles — context rot kills
   quality.
4. **Write each result back immediately** and advance that item's state. Progress persists
   per-item.
5. **No per-tick cap** — loop until drained. A crash at item 7 is a non-event: next tick pulls
   the remaining 8 (resumability, not heroics, guarantees completion).
6. **Single-flight lock** — a tick skips if a worker is already running, so a long tick and the
   next scheduled tick don't double-write.
7. **Item lease/claim** — claiming an item stamps a transient in-progress sub-state so (a) two
   ticks can't grab the same item and (b) the inline editor is locked while a rewrite is mid-flight
   (closes the edit-vs-rewrite race).
8. **Per-item failure is isolated** — a compliance halt or API error flags that one item and the
   loop continues; one bad article never blocks the other fourteen.
9. **Bot identity** — worker authenticates as a dedicated **"Troubador" service user** (its own
   `User` row + API key). Activity log attributes worker writes to it ("Troubador drafted" vs
   "Mike approved").

---

## 7. Publishing calendar

A **Publishing Calendar** tab (per site, and a client-wide view) shows what publishes when across
all runs. It is the dedup surface for **same-site same-day** collisions and the human's view of
calendar fullness (which feeds the schedule's "keep it full" derivation). Cross-client same-day is
fine.

*(Actual publish mechanics — Eleventy git commit / WP REST — are deferred; see §0 and §10.2.)*

---

## 8. Data model (Prisma)

Conventions matched to `app/prisma/schema.prisma`: UUID PKs, snake_case, `is_deleted`,
`created_at`/`updated_at`, `@@map` to plural snake_case tables, FK + relation pairs, `@@index` on
FKs and filter columns.

> **Decision (§10.1):** dedicated models, **not** Project/Task reuse — the lifecycle differs
> enough (run stages, article table, schedules, worker leases) that bending Project/Task would
> cost more than it saves. We still *associate* with Client + Site like everything else.

### New enums

```prisma
enum TroubadorRunStage {
  planning
  topic_selection
  researching
  ready_for_interview
  in_production
  publishing
  done
  cancelled
}

enum ArticleStatus {
  pending_research
  researched
  drafting
  in_review        // == "ready for review/approval"
  needs_revision
  approved
  scheduled
  published
  postponed        // parked — doesn't block run→Done; reactivatable / goes to backlog
  dropped
}

enum ArticleCheckState {
  pending
  passed
  check_failed       // non-compliance check failed; surfaced flagged
  compliance_hold    // fail-closed; parked, not in normal queue
}

enum InterviewStatus {
  pending
  in_progress
  complete
}

enum ScheduleStatus {
  active
  paused
  ended
}

enum SiteType {        // reserved for deferred publishing
  eleventy
  wordpress
}

enum TopicArchetype {
  pillar
  thought_leadership
  case_study
  how_to
  commodity
}
```

### Site additions (reserve publish config now)

```prisma
// add to existing model Site:
  site_type            SiteType?        // null until configured
  // Eleventy targets (deferred use):
  repo_url             String?          @db.VarChar(500)
  repo_branch          String?          @db.VarChar(100)
  content_dir          String?          @db.VarChar(255)
  // WordPress targets (deferred use):
  wp_base_url          String?          @db.VarChar(500)
  wp_default_author    String?          @db.VarChar(255)
  wp_default_category  String?          @db.VarChar(255)
  // (WP credentials NOT stored here in v1 — publishing deferred)

  troubador_schedules  TroubadorSchedule[]
  troubador_runs       TroubadorRun[]
  articles             Article[]
```

### Client back-relations

```prisma
// add to existing model Client:
  troubador_schedules  TroubadorSchedule[]
  troubador_runs       TroubadorRun[]
```

### TroubadorSchedule

```prisma
model TroubadorSchedule {
  id                 String         @id @default(uuid()) @db.Uuid
  client_id          String         @db.Uuid
  client             Client         @relation(fields: [client_id], references: [id])
  site_id            String         @db.Uuid
  site               Site           @relation(fields: [site_id], references: [id])

  name               String         @db.VarChar(255)
  status             ScheduleStatus @default(active)

  // Cadence model: "keep the calendar full"
  target_article_count Int          @default(4)     // soft target per run
  publish_per_week     Decimal      @db.Decimal(5,2) // publish throughput
  lead_time_days       Int          @default(7)      // how early to start the next run

  // Briefing defaults (inherited by each run's brief)
  overarching_goals  String?        @db.Text

  default_assignee_id String?       @db.Uuid
  default_assignee    User?         @relation("ScheduleDefaultEditor", fields: [default_assignee_id], references: [id])

  allow_concurrent   Boolean        @default(false)  // stack policy
  start_date         DateTime                          // first run drops on this date
  skip_next          Boolean        @default(false)    // skip-once
  last_run_at        DateTime?                          // bookkeeping for "next run" derivation

  is_deleted         Boolean        @default(false)
  created_at         DateTime       @default(now())
  updated_at         DateTime       @updatedAt
  created_by_id      String?        @db.Uuid

  runs               TroubadorRun[]

  @@index([client_id])
  @@index([site_id])
  @@index([status])
  @@index([default_assignee_id])
  @@map("troubador_schedules")
}
```

### TroubadorRun

```prisma
model TroubadorRun {
  id                 String            @id @default(uuid()) @db.Uuid
  client_id          String            @db.Uuid
  client             Client            @relation(fields: [client_id], references: [id])
  site_id            String            @db.Uuid
  site               Site              @relation(fields: [site_id], references: [id])
  schedule_id        String?           @db.Uuid       // null for manual runs
  schedule           TroubadorSchedule? @relation(fields: [schedule_id], references: [id])

  title              String            @db.VarChar(255)
  stage              TroubadorRunStage @default(planning)

  // Per-run brief (inherits schedule goals, editor-refined in Planning)
  brief              String?           @db.Text
  goal_type          String?           @db.VarChar(50)  // authority | promote | pain_point
  target_offering    String?           @db.VarChar(255)
  must_cover         String?           @db.Text
  avoid              String?           @db.Text

  // Human gates (signals the worker reads; never self-advanced past)
  ready              Boolean           @default(false)  // Planning → Topic Selection
  selection_ready    Boolean           @default(false)  // Topic Selection → Researching
  // interview gate is set by the Troubador CLI skill, not a UI flag (see interview.status)

  assignee_id        String?           @db.Uuid
  assignee           User?             @relation("RunEditor", fields: [assignee_id], references: [id])

  // Worker lease (single-flight + claim at run level: proposals/research)
  claimed_at         DateTime?
  claimed_by_id      String?           @db.Uuid

  is_deleted         Boolean           @default(false)
  created_at         DateTime          @default(now())
  updated_at         DateTime          @updatedAt
  created_by_id      String?           @db.Uuid

  proposals          TopicProposal[]
  articles           Article[]
  interview          Interview?

  @@index([client_id])
  @@index([site_id])
  @@index([schedule_id])
  @@index([stage])
  @@index([assignee_id])
  @@map("troubador_runs")
}
```

### TopicProposal

```prisma
model TopicProposal {
  id              String          @id @default(uuid()) @db.Uuid
  run_id          String          @db.Uuid
  run             TroubadorRun    @relation(fields: [run_id], references: [id], onDelete: Cascade)

  title           String          @db.VarChar(500)
  archetype       TopicArchetype?
  primary_keyword String?         @db.VarChar(255)
  search_volume   Int?
  keyword_difficulty Int?
  rationale       String?         @db.Text
  source          String          @default("troubador") // troubador | human
  selected        Boolean         @default(false)
  saved_for_later Boolean         @default(false)  // → client backlog; next run surfaces these first

  created_at      DateTime        @default(now())
  updated_at      DateTime        @updatedAt

  @@index([run_id])
  @@map("troubador_topic_proposals")
}
```

### Article

```prisma
model Article {
  id              String            @id @default(uuid()) @db.Uuid
  run_id          String            @db.Uuid
  run             TroubadorRun      @relation(fields: [run_id], references: [id], onDelete: Cascade)
  // denormalized for cross-run queries (worker queue, site calendar)
  client_id       String            @db.Uuid
  client          Client            @relation(fields: [client_id], references: [id])
  site_id         String            @db.Uuid
  site            Site              @relation(fields: [site_id], references: [id])

  slug            String            @db.VarChar(255)   // stable id for worker upserts
  title           String            @db.VarChar(500)
  status          ArticleStatus     @default(pending_research)
  check_state     ArticleCheckState @default(pending)
  check_report    Json?             // per-check pass/fail + reasons

  research_summary String?          @db.Text
  body            String?           @db.Text           // md (Eleventy) or HTML (WP); source of truth at publish
  social_copy     String?           @db.Text

  // scheduling
  suggested_date  DateTime?
  scheduled_date  DateTime?
  published_url   String?           @db.VarChar(500)

  // approval / locking
  approved_at     DateTime?
  approved_by_id  String?           @db.Uuid
  locked          Boolean           @default(false)    // true once approved → worker won't touch

  // worker lease (per-article: draft/rewrite)
  claimed_at      DateTime?
  claimed_by_id   String?           @db.Uuid

  is_deleted      Boolean           @default(false)
  created_at      DateTime          @default(now())
  updated_at      DateTime          @updatedAt

  comments        ArticleComment[]

  @@unique([run_id, slug])
  @@index([run_id])
  @@index([client_id])
  @@index([site_id])
  @@index([status])
  @@index([scheduled_date])
  @@map("troubador_articles")
}
```

### ArticleComment (feedback chain)

```prisma
model ArticleComment {
  id         String   @id @default(uuid()) @db.Uuid
  article_id String   @db.Uuid
  article    Article  @relation(fields: [article_id], references: [id], onDelete: Cascade)
  user_id    String?  @db.Uuid    // null = Troubador bot note
  user       User?    @relation(fields: [user_id], references: [id])
  content    String   @db.Text
  is_feedback Boolean @default(true)  // true = revision request the worker should act on
  resolved   Boolean  @default(false) // worker marks resolved after addressing
  is_deleted Boolean  @default(false)
  created_at DateTime @default(now())

  @@index([article_id])
  @@index([created_at])
  @@map("troubador_article_comments")
}
```

### Interview

```prisma
model Interview {
  id          String          @id @default(uuid()) @db.Uuid
  run_id      String          @unique @db.Uuid
  run         TroubadorRun    @relation(fields: [run_id], references: [id], onDelete: Cascade)
  status      InterviewStatus @default(pending)
  questions   Json?           // consolidated prep questions (posted by worker, emailed to client)
  transcript  String?         @db.Text   // or a ref; written by the CLI skill on completion
  completed_at DateTime?
  created_at  DateTime        @default(now())
  updated_at  DateTime        @updatedAt

  @@map("troubador_interviews")
}
```

*(User back-relations to add: `ScheduleDefaultEditor`, `RunEditor`, and the `Article.approved_by`
/ `ArticleComment.user` relations.)*

---

## 9. API surface + registry

Auth: worker uses a **Bearer API key** for the "Troubador" service user (existing `ApiKey`
mechanism, `Authorization: Bearer citadel_<key>`). Human UI uses session auth as normal.
Write semantics: **upserts keyed by stable ids** (run id, `article.slug`) so re-runs don't
duplicate. Worker respects human gates (`ready`, `selection_ready`, `approved`) — never advances
past them.

**Worker (machine) endpoints**
- `GET  /api/troubador/work-queue` — flattened list of actionable items across all runs, ordered
  by urgency (the worker's single entry point each tick)
- `POST /api/troubador/runs/:id/claim` / `POST /api/troubador/articles/:id/claim` — lease
- `POST /api/troubador/runs/:id/proposals` — upsert proposals; advance to Topic Selection
- `POST /api/troubador/runs/:id/research` — per-article research; advance to Ready for Interview
  when all done
- `POST /api/troubador/runs/:id/interview-questions` — attach consolidated prep questions
- `POST /api/troubador/runs/:id/interview-complete` — CLI skill marks interview done → In Production
- `PATCH /api/troubador/articles/:id` — set draft body/social, check_state/report, status
  transitions the worker is allowed (`drafting→in_review`, `needs_revision→in_review`)

**Human / UI endpoints**
- `GET/POST/PATCH/DELETE /api/troubador/schedules` (+ `/:id`) — schedule CRUD; filter active/client
- `GET/POST/PATCH /api/troubador/runs` (+ `/:id`) — board, run detail, set gates, assignee
- `PATCH /api/troubador/runs/:id/proposals` — select/add custom topics
- `PATCH /api/troubador/articles/:id` — approve, drop, edit body, set scheduled_date
- `POST  /api/troubador/articles/:id/comments` — leave feedback (flips to needs_revision)
- `GET   /api/troubador/calendar?site_id=` — publishing calendar (collision surface)
- `GET   /api/troubador/dashboard` — the editor's flattened action queue

**Registry update (the endpoint-map LLMs read):** add
`app/lib/api/registry/troubador.ts` exporting `troubadorEndpoints: ApiEndpoint[]`, import +
spread it in `app/lib/api/registry/index.ts`, and add any new enums to `apiEnums`. This is what
`GET /api/docs` serves to the Bast machine for endpoint discovery — **must ship with the
endpoints, same change.** Follow `api-routes.md`: `requireAuth()`, Zod validation,
`handleApiError()`.

---

## 10. Open decisions (carry into the plan)

1. ~~**Editor role:** per-run `assignee` or global `UserRole.editor`?~~ **DECIDED:** the editor is
   the **schedule's `default_assignee`**, inherited by every run it spawns into
   `run.assignee_id`, and **overridable per run**. Manual runs default to creator. No global
   `UserRole` — "editor" is purely the assignment, no permission-system change.
2. ~~**Publish ownership.**~~ **DECIDED:** the **Bast cron owns publishing**, running from the LLM
   computer (the worker), for **both** site types. Citadel never publishes server-side. Site config
   fields stay reserved; execution is a deferred phase (§0).
3. ~~**Research/Writing board legibility.**~~ **DECIDED:** board stays collapsed (Researching is its
   own column; everything post-interview is "In Production"). The requirement is **surfacing
   review-needed** — a count badge on the run card + the dashboard queue (§2).
4. ~~**Run-advance aggregate rules.**~~ **DECIDED:** a run reaches **Done when every article is
   `published`, `dropped`, or `postponed`** — postpone is the release valve for stuck articles so
   one never holds the run hostage. (Other transitions: → Researching when `selection_ready`;
   → Ready-for-Interview when all selected articles `researched`; → In-Production on
   interview-complete.) Reactivating a postponed article after Done pulls it into a future run via
   the backlog.
5. ~~**Topic carryforward.**~~ **DECIDED + extended** (see §5b): a per-client **Backlog** fed by both
   `saved_for_later` topic proposals *and* `postponed` articles; the next run surfaces backlog items
   first. Models now carry the flags (`TopicProposal.saved_for_later`, `Article.status = postponed`).

*(No open decisions remain that block the build.)*

---

## 11. Build phasing (for the implementation plan)

Follow `CLAUDE.md` agent workflow (Impact Analysis → Plan → Implement → Test, zero broken tests).

1. **Schema + migration** — enums, Site additions, 5 new models, back-relations. Seed the
   "Troubador" service user + API key.
2. **API + registry** — endpoints in §9, `troubador.ts` registry file, `apiEnums` additions,
   tests for handlers.
3. **Scheduler** — server-side run instantiation (cadence/lead-time derivation, stack policy,
   start-date, no-backfill, skip-once).
4. **Board + run detail UI** — columns (§2), article table (§3), feedback/approve/drop/schedule.
5. **Schedules UI** — Troubador "Schedules" tab + Client "Publishing" tab (one object, two views).
6. **Dashboard queue + notifications** — editor work queue, notification types, Bast digest hook.
7. **Publishing calendar UI** — per-site + client-wide; collision surfacing.
8. **(Deferred)** publishing execution (Eleventy/WP) via the worker.
```
