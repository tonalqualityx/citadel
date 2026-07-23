# Clarity Phase 6 — Email Lanes & Calendar Intents — Verification Record

Spec: `feature-planning/clarity-phase6-email-lanes.md`. Plan:
`app/implementation/plans/clarity-phase6-email-lanes.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`; Phases 1–5 + 4c already
live. Machine-side classifier/calendar-executor cron work is explicitly out of scope here —
Bast's separate post-deploy follow-up (contract at the bottom of this record).

## Baseline

- `npm run test:run`: **1827 tests / 153 files, exit 0.**
- `npx playwright test`: **33 passed / 0 failed, exit 0.**

Both matched the spec's stated floor exactly (Phase 4c's own final gate) — no drift since.

## Migration

`prisma/migrations/20260723143908_clarity_phase6_email_intents/` — new `EmailAskIntent`
enum (`general|meeting|sales`) via a guarded `DO $$ ... EXCEPTION WHEN duplicate_object`
block (Postgres has no native `CREATE TYPE ... IF NOT EXISTS`, unlike `ADD COLUMN`, so this
is the standard workaround for the standing "IF NOT EXISTS on the enum" rule applied to a
brand-new type rather than an existing one); 6 additive `email_asks` columns, each
`IF NOT EXISTS`: `intent EmailAskIntent?`, `proposed_event_at TIMESTAMP(3)?`,
`proposed_event_title VARCHAR(500)?`, `proposed_event_minutes INTEGER?`,
`calendar_requested BOOLEAN NOT NULL DEFAULT false`, `calendar_event_id VARCHAR(255)?`.

Applied cleanly via `prisma migrate dev --name clarity_phase6_email_intents` (create-only,
hand-edited for the guards, then applied) — `prisma migrate status` was clean before and
after. **Idempotency proven**: re-ran the raw migration SQL directly via
`npx prisma db execute --file .../migration.sql` against the already-migrated database —
exited cleanly with "Script executed successfully", confirming both the enum guard and the
6 `IF NOT EXISTS` column guards are genuinely safe to re-run.

## Server-side additions

1. **`formatEmailAskResponse`** (`lib/api/formatters.ts`) now passes through all 6 new
   fields (`?? null`/`?? false` defaults — never throws on a pre-migration row shape).
2. **`POST /api/oracle/email-sync`** accepts `intent`/`proposed_event_at`/
   `proposed_event_title`/`proposed_event_minutes`, all optional. Byte-compatibility is
   enforced via a conditional-spread (`...(ask.intent !== undefined && {intent: ask.intent})`)
   applied to BOTH the `create` and `update` branches of the upsert — a legacy classifier
   payload that never sends these keys leaves them completely absent from the Prisma call
   (verified directly: `expect(call.create).not.toHaveProperty('intent')`), not merely
   defaulted to null on top of an existing value. This is a genuinely different discipline
   from the pre-existing fields on this same endpoint (`thread_id`, `gist`, etc.), which
   always overwrite with `?? null` — flagged explicitly in code comments so a future phase
   extending this endpoint doesn't accidentally copy the wrong pattern.
3. **`PATCH /api/email-asks/[id]`** accepts `calendar_requested: boolean` (only ever set
   `true` from the UI; no "un-request" path exists).
4. **`GET /api/email-asks`** gains `?calendar_requested=true` (only `"true"` is a valid
   value — there's nothing meaningful to filter for on `false`).
5. **`GET /api/waiting-on-me`** — `intake` gains `lanes: {general, meeting, sales}`,
   computed server-side from the same `intakeAsks` query the response already runs (null
   intent counted as general). `crisis` is untouched — lanes are an intake-only concept per
   the spec.
6. Registry updated in both `lib/api/registry/oracle.ts` (email-sync) and
   `lib/api/registry/clarity.ts` (email-asks GET/PATCH, waiting-on-me).

## UI (Seeing Stone)

- **Trigger chip** (`intakeChipLine` in `intake-drawer-logic.ts`) — one quiet count per
  non-empty lane in general/meeting/sales order (`📬 4 · 🤝 1 · 💰 2`), zero-count lanes
  render nothing; all-zero falls back to the pre-existing `📬 Intake · 0` line (reusing
  `intakeSummaryLine` for that one branch rather than duplicating the string).
- **Drawer grouping** (`groupAsksByLane`) — Meeting, Sales, General order (a DIFFERENT
  order from the chip's general/meeting/sales — both orders are literal spec text, kept as
  two separate constants rather than collapsed into one "the" order), empty lanes render no
  header at all.
- **Meeting cards** — `MeetingEventBlock` sub-component renders nothing at all when
  `proposed_event_at` is null (never guessed, never a disabled button — Mike's explicit
  confidence-rule requirement, verified by a dedicated unit + e2e test asserting the
  add-to-calendar testid has zero count on an unparsed meeting ask). When set: prominent
  `formatProposedEvent` line (`📅 Thu 7/24 · 3:30 PM · 45m`) + a 4-state button
  (`calendarButtonState`: none/add/queued/added) — click PATCHes `calendar_requested: true`,
  which flips the button to a static "queued for calendar ⏳" label (not a disabled button);
  `calendar_event_id` (machine-set only) renders "added ✓".
- **Sales cards** — Create/Create+open become "Create lead quest"/"Create lead quest + open"
  (design decision on the exact second string — see Deviations).
- Mobile: lanes stack vertically (verified via bounding-box comparison in e2e, not just a
  visual screenshot check), chip counts stay visible in the header.

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1866 tests / 153 files, exit 0** (baseline 1827/153 + 34 new/updated for the main phase + 5 new for the `calendar_event_id` addendum) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npx playwright test` (full suite) | **36 passed / 0 failed, exit 0** (baseline 33 + 3 new — addendum is API-only, no e2e impact) |

New e2e: `__tests__/e2e/oracle-phase6-email-lanes.spec.ts` (3 tests, fixtures from
`scripts/seed-clarity-phase6-lane-fixtures.ts`): trigger chip + drawer lane grouping with a
desktop screenshot; Add-to-calendar appears ONLY on the meeting ask with a parsed date
(explicitly asserts zero count on the sales/general cards) and click flips it to the queued
label; mobile stacking + no horizontal overflow with a screenshot.

Screenshots: `app/test-results/clarity-phase6/desktop-1280-oracle-intake-three-lanes.png`,
`app/test-results/clarity-phase6/mobile-390-oracle-intake-three-lanes.png` — both visually
confirmed: Meeting/Sales/General headers in order, prominent parsed time + Add to calendar
button on the meeting card only, "Create lead quest"/"Create lead quest + open" on the sales
card, plain "Create"/"Create + open" on the general card, no horizontal overflow on mobile.

## Deviations

1. **Sales lead-flavored copy extended to both buttons, not just "Create"** — the spec gives
   one example string ("Create lead quest") for "lead-flavored copy" on "Create /
   Create+open" without fully specifying the second button's text. Chose "Create lead quest
   + open" for parallel construction rather than leaving Create+open unflavored. Low-risk,
   easily renamed if Mike prefers different copy.
2. **Chip order (general/meeting/sales) intentionally differs from drawer order
   (Meeting/Sales/General)** — both are literal, distinct spec text ("📬 4 · 🤝 1 · 💰 2" vs
   "Meeting, Sales, General — in that order"). Implemented as two separate constants in
   `intake-drawer-logic.ts` rather than normalizing to one shared order, with a comment
   flagging this is deliberate so a future refactor doesn't "fix" it into one order by
   accident.
3. **Two pre-existing e2e assertions updated for the new chip format** —
   `oracle-phase4a-email.spec.ts` and `oracle-phase4b-peek.spec.ts` both asserted the exact
   literal `/📬 Intake · \d+/` on the shared intake trigger chip; Phase 6 changes that
   format unconditionally (any lane count > 0 switches to the lanes format). Both loosened
   to `/📬\s*\d+/`, which still discriminates from the all-zero fallback text correctly
   (verified: "Intake" is not a digit, so the zero-state string doesn't accidentally match).
   No other files reference this chip's text.
4. **`?calendar_requested` query param accepts only the literal `"true"`, not
   `"true"|"false"`** — there is no "un-request" action in this phase (per spec, Mike can
   only ever set it true from the UI), so a `false` filter would have no real use case; kept
   the zod schema narrow (`z.enum(['true'])`) rather than accepting a value nothing produces.

## Sync-field contract for Bast's machine-side follow-up (classifier + calendar executor)

**Classifier → `POST /api/oracle/email-sync`** (batch, max 200/call, existing bearer auth):
every ask object may now additionally include, all optional and independently omittable
(omitting a field leaves it untouched on a re-sync, never nulls it out):

- `intent`: `"general" | "meeting" | "sales"` — omit or send `"general"` for anything that
  isn't clearly one of the other two; the UI treats omitted/null identically to `"general"`.
- `proposed_event_at`: ISO-8601 string — **only ever send this when the classifier is
  HIGH-CONFIDENCE about a specific parsed date/time.** There is no "maybe" state; if in
  doubt, omit it entirely. The UI shows an Add-to-calendar button if and only if this field
  is non-null — a wrong guess here directly produces a wrong calendar event once the
  (separately-built) calendar executor acts on it.
- `proposed_event_title`: string (≤500 chars) — a short human title for the proposed event
  (e.g. "Call with Jane Client"). Optional even when `proposed_event_at` is set, though in
  practice the executor will want SOME title to put on the calendar event.
- `proposed_event_minutes`: positive integer — the parsed/assumed duration. Optional; the
  UI's prominent time line simply omits the "· Nm" segment when absent.

**Calendar executor → reads `GET /api/email-asks?calendar_requested=true`** (same bearer
auth as email-sync) to find asks Mike has clicked "Add to calendar" on. For each: create the
real Google Calendar event using `proposed_event_at`/`proposed_event_title`/
`proposed_event_minutes` (fall back to a sane default duration if minutes is null), then
**`PATCH /api/email-asks/{id}` with `{ calendar_event_id: <the new event's id> }`.**

**Addendum (closed the gap flagged above):** `PATCH /api/email-asks/[id]` now accepts
`calendar_event_id` (string, ≤255 chars, nullable). Setting it — including explicitly
clearing it to `null` — atomically flips `calendar_requested` back to `false` in the SAME
update, regardless of what else the request body sent (verified: a request sending both
`calendar_event_id` and `calendar_requested: true` still ends up with `calendar_requested:
false`). This closes the requested → executed transition: the executor's single PATCH call
is now sufficient to make the UI's button render "added ✓" with no separate call needed to
also clear the request flag. Registry updated. 5 new unit tests (set-and-clear-flag,
precedence-over-explicit-calendar_requested, omit-leaves-untouched, explicit-null-clear,
over-length-rejection).

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec + plan + verification
record committed alongside the implementation, chunked per repo convention (db → api →
oracle-ui → test/e2e → docs). No push.
