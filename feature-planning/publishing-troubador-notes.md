# Feature Planning — Troubador Control Plane in Citadel

*Status: planning notes. Captures the design discussed for integrating the Troubador content
engine with Citadel. To be built in Citadel independently; Troubador (a separate Claude Code
skill/CLI) is the external worker that talks to this feature via API.*

---

## 1. What this is

A new **"Troubador" section in Citadel** — a Kanban board that is the **control plane** for
content-production runs. Each **card = one content run** for a specific client **site**.

- **Citadel** owns the board, the run state (columns = pipeline stages), the human touchpoints
  (trigger, topic selection, approval, scheduling), and the API.
- **Troubador** (external, runs in a terminal; not part of Citadel) is the **worker**. A human
  fires it; it reads cards that are ready for work, does the work (research, question
  generation, writing), writes results back to the card, and advances the card to the next
  column. It is a **pull model** — no webhooks required initially.

The columns *are* the run's state machine. The board is the visible, actionable version of a
week-long async process that spans several human/worker touchpoints.

> Why this matters: a content run is not a single sitting. Example real timeline — Day 0: PM
> triggers a run. Day 2: client picks topics. Day 3: PM triggers research + interview. Later:
> approval, then scheduled publishing. Citadel holds that state so any party can see "where is
> this run" at a glance.

---

## 2. Relationship to existing Citadel entities

- A run card is tied to an existing **Client** and **Site** (Citadel already models these).
- The **Site** entity needs new publishing config (see §7): `site_type` (eleventy | wordpress)
  and the details needed to publish to it.
- A run is conceptually similar to a **Project with Tasks** (parent card + child article
  items). Reuse that pattern if it fits, or a dedicated model — implementer's call.

---

## 3. The board: columns (pipeline stages) and who advances each

| # | Column | What Troubador does | What the human does | Advance trigger |
|---|--------|---------------------|---------------------|-----------------|
| 1 | **Intake / Requested** | — | Creates the card for a site + writes **intake notes** (the campaign brief — see §4). Marks "ready for recommendations." | Human sets `ready` flag |
| 2 | **Topic Selection** | Posts ~20 topic proposals to the card (each: title, archetype, primary keyword, volume, difficulty, rationale) | Checks off topics to write; can **add custom topics**; clicks "ready" | Human sets `selection_ready` flag |
| 3 | **Researching** | Researches each selected topic **one at a time**, stores research, posts progress | — | Troubador advances when all research done |
| 4 | **Ready for Interview** | Posts the **consolidated** interview questions (pooled across the interview-driven topics) | Runs the interview with the client **in terminal** (for now); marks interview complete | Human sets `interview_complete` flag |
| 5 | **Writing** | Writes each article + finished social assets | — | Troubador advances when drafts done |
| 6 | **Approval** | Posts each article's copy + social to the card | Per article: **add feedback** (→ revision) or **approve** | All articles approved |
| 7 | **Scheduling** | Publishes each approved article per site type (see §7); sets status | Sets/*confirms* publish dates | Articles scheduled/published |
| 8 | **Done / Published** | — | — | terminal |

Notes:
- Columns 3 & 5 may merge if you prefer fewer columns; keep them distinct if you want research
  and writing visible as separate states.
- A "needs revision" on approval sends that **article item** back to Writing without moving the
  whole card.

---

## 4. Intake notes are the campaign brief (first-class input)

The intake notes are **not just a comment** — they steer topic generation, research focus, and
interview questions. Treat them as structured-ish:

- Free-text brief, plus optional structured hints:
  - **Goal type:** build authority | promote a service/product | target a specific pain point
  - **Target service/product** (if promoting one)
  - **Emphasis / must-cover topics**
  - **Avoid** (topics/angles to skip)

Troubador reads these and biases the whole run toward the goal (e.g. "promote the new X
service → propose topics around the pain points X solves, and generate interview questions that
surface the client's distinctive take on those pain points").

---

## 5. Card data model (what Citadel needs to store)

**Run card**
- `id`, `client_id`, `site_id`, `column/stage`, `created_at`, `updated_at`
- `intake_notes` (brief + structured hints from §4)
- stage flags: `ready`, `selection_ready`, `interview_complete` (human-set signals Troubador reads)
- timeline / activity log (who did what when — nice for the async arc)

**Topic proposals** (children of the card; created by Troubador, edited by human)
- `title`, `archetype` (pillar | thought-leadership | case-study | how-to | commodity),
  `primary_keyword`, `search_volume`, `keyword_difficulty`, `rationale`, `source` (troubador | human),
  `selected` (bool)

**Article items** (one per selected topic; the unit of work through stages 3–8)
- `id`, `slug`, `title`, `status` (researching | ready-for-interview | writing | approval | approved | scheduled | published | needs-revision)
- `research_summary` (or link/ref), `article_copy` (markdown or HTML), `social_copy`
- `feedback` (thread of human notes on revisions)
- `scheduled_date`, `publish_target` (resolved from the Site), `published_url`

**Interview**
- consolidated `questions` (list), `status` (pending | in-progress | complete), `transcript` (or ref)

---

## 6. API surface Citadel must expose (for the Troubador worker)

Token auth (Troubador already has a Citadel API token). Endpoints (shape illustrative):

**Read (Troubador polls these on invocation to find work):**
- `GET /api/troubador/cards?stage=intake&ready=true` → cards needing topic proposals
- `GET /api/troubador/cards?stage=selection&selection_ready=true` → cards ready to research
- `GET /api/troubador/cards?stage=interview&interview_complete=true` → cards ready to write
- `GET /api/troubador/cards?stage=approval` → article items with approvals/feedback
- `GET /api/troubador/cards?stage=scheduling&status=approved` → articles to publish
- `GET /api/troubador/cards/:id` → full card detail (intake notes, selected topics, dates, feedback)

**Write (Troubador posts results + advances cards):**
- `POST /api/troubador/cards/:id/proposals` → attach topic proposals; move card to Topic Selection
- `POST /api/troubador/cards/:id/research-progress` → per-topic research status
- `POST /api/troubador/cards/:id/interview-questions` → attach consolidated questions; move to Ready for Interview
- `PATCH /api/troubador/articles/:id` → set status, attach copy/social, set published_url
- `POST /api/troubador/cards/:id/move` → move to a named column

**Concurrency/idempotency:** Troubador may run repeatedly. Writes should be **upserts** keyed by
stable ids (card id, article slug) so re-runs don't duplicate. Human-set flags (`selection_ready`,
`interview_complete`, approvals) are the gates Troubador respects — it never self-advances past a
human gate.

---

## 7. Publishing / scheduling (the asymmetric part)

Publish config lives on the **Site** entity: `site_type` + the details below.

### Eleventy (static) sites — future-date + scheduled rebuild (chosen model)
Rationale: **resilient** — once the article is committed and pushed, the repo is the source of
truth; a dead Troubador machine can't lose a scheduled post.

Mechanism:
1. Troubador (terminal — it has git/repo access) **pulls the latest** site repo, adds **just the
   new article file** future-dated, commits, pushes. (Pull-first avoids clobbering other changes.)
2. The Eleventy build **filters out `date > now`** from pages, RSS, and sitemap, so the post is
   dormant in the repo until its date arrives.
3. A **scheduled GitHub Actions `cron` build** (e.g. daily) re-evaluates "now" and publishes any
   post whose date has passed. Build in **UTC** for unambiguous dates.

Citadel's role: store `scheduled_date`, the target repo/branch + content dir, and show
publish status. The git commit itself is done by Troubador (terminal). Site config needs:
repo URL/path, branch, content directory, optional cron build expectations.

### WordPress sites — REST API native scheduling
- Create the post via WP REST: `status=future`, `date=scheduled_date`. WP handles the rest.
- Citadel already manages sites/hosting, so it may hold WP credentials and could perform this
  **server-side** (cleaner than doing it from the terminal). Site config needs: WP base URL,
  auth (application password / token), default author/category.

**Decision to confirm:** who performs publish actions —
- Eleventy: **Troubador (terminal)** does the git work (it has repo access). ✔ recommended
- WordPress: **Citadel (server)** does the REST call (it holds creds). ✔ recommended

---

## 8. Sync / trigger model

- **Pull-based, human-initiated.** The PM fires Troubador in the terminal; it queries Citadel
  for cards needing work at each stage, does the work, writes back, advances cards. No webhook or
  always-on poller needed for v1.
- **Citadel is the source of truth** for run state. Troubador keeps a thin local mirror
  (research artifacts, the content index / knowledge graph) but never disagrees with the board.
- Later (optional): webhooks or a poller so research/writing kick off automatically when a human
  gate is set, without a manual terminal trigger.

---

## 9. What Citadel needs to build (checklist)

- [ ] **Data model** (Prisma): run card, topic proposals, article items, interview — tied to Client + Site.
- [ ] **Site config additions:** `site_type` (eleventy | wordpress) + publish details (repo/branch/content-dir for Eleventy; base URL + auth for WP).
- [ ] **Kanban board UI** under a new "Troubador" section: columns per §3.
- [ ] **Card detail UI:** intake-notes editor (§4); topic checklist with add-custom (§3 col 2);
      per-article copy review with feedback/approve (§3 col 6); scheduling UI (§3 col 7).
- [ ] **API endpoints** for the Troubador worker (§6) with token auth + upsert semantics.
- [ ] **WP publish action** (server-side REST scheduling) if WP sites are in scope.
- [ ] **Activity log** on the card for the async timeline.

---

## 10. Open questions / decisions

1. **Model reuse:** does the run card reuse Citadel's Project/Task model, or a dedicated
   `TroubadorRun` + `ArticleItem` model? (Leaning dedicated — the lifecycle differs.)
2. **Publish ownership:** confirm Eleventy = Troubador-terminal git, WordPress = Citadel-server REST.
3. **Granularity:** approval + scheduling at the **article-item** level (recommended), with the
   card advancing only when all its articles clear a stage.
4. **Permissions:** which Citadel roles can trigger a run, select topics, and approve copy?
5. **Auto-vs-manual worker:** v1 is manual terminal trigger; do we want a poller later so a set
   human gate auto-kicks the next Troubador stage?
6. **Where the article copy lives:** stored on the card in Citadel for review, and as files on
   the Troubador side; on approval, Troubador is the one that commits to the site repo.

---

## Appendix — Troubador pipeline (for context; built separately)

Keyword research (DataForSEO) → topic proposals (archetype-tagged) → human selection → factual
research per topic (Perplexity, stored to a knowledge graph) → consolidated research-driven
interview (adaptive: digs until each question is clearly answered, follows new threads) →
brief → draft (markdown for Eleventy / HTML for WP) + finished social → 11 review checks
(incl. per-client compliance, fail-closed) → per-site publish gate → publish.

A per-client **knowledge graph** (issues / client positions / sources, vector-embedded)
accumulates across runs — the client's positions on contested areas become a queryable asset, so
later runs interview less and reuse established stances. The Citadel board is the human-facing
control surface over this engine.
