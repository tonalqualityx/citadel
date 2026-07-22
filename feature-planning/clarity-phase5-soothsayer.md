# Clarity Phase 5 — The Soothsayer + Needs Reshi rework

Mike's rulings 2026-07-22 (all confirmed): (1) new Soothsayer screen visualizing the week plan;
(2) Decide+Answer MERGE into one "Waiting on you" queue; (3) flag-only "waiting for input" cards
leave the glass — replaced by an attention dot on the linked arc; (4) Review gets grouped by
client/arc; (5) the 20-minute meeting-prep rule enters the time-shape.

Hard rules identical to all prior phases. Baselines: vitest 1705/147, Playwright 20/0 — capture
real exit codes. Additive-only migrations (IF NOT EXISTS on multi-path DDL). No push.

## A. Schema (one additive migration `clarity_phase5_arc_snooze`)

`Arc.snoozed_until DateTime?` — a snoozed arc is hidden from default surfaces until the date
passes. PATCH /api/arcs/[id] accepts it (set/null). Registry updated.

## B. Future-dated Today picks = the week plan

Verify POST /api/today accepts any date (future dates included) — the WIP cap applies PER DAY.
If anything blocks future dates, fix it. This is the Soothsayer's data: the ritual writes picks
onto future days; no new planning model exists or is wanted.

## C. The Soothsayer — new page `/oracle/soothsayer`, admin-gated, nav item under Oracle (pick a
theme-fitting emoji, e.g. 🌙 or 🗓)

1. **Day columns**: today + next 6 days in the requester's resolved timezone. Each column: the
   day's picks rendered as compact cards (arc name + progress, session title, task title — reuse
   existing card components where possible), plus a one-line meeting load for that day (count +
   total hours incl. 20-min prep + 15-min recovery buffers, from the calendar data). Today's
   column visually anchored (accent border).
2. **"No day assigned"** section below: every OPEN (incomplete, un-snoozed) arc with NO pick
   today-or-future, and every LIVE session (fleet: not ended/stale) with no pick — each with a
   quick "assign to day" action (small day-picker → POST /api/today for that date, respecting the
   per-day cap with its 409 surfaced). This section is the can-never-lose-an-arc guarantee.
3. **"Snoozed"** collapsed row at the bottom: arcs with snoozed_until in the future, showing wake
   date, with unsnooze + snooze-adjust actions. Arc cards elsewhere get a snooze action (small
   menu: 1d / 3d / next week / pick date → PATCH snoozed_until).
4. Mobile: columns become a vertical day list, No-day-assigned stays prominent.

## D. Needs Reshi rework (Seeing Stone)

1. **Merge**: Decide + Answer → ONE queue titled "Waiting on you". Items = declared session asks
   (manifest) with a small type chip (decision / reply) preserving flavor. Server: /api/waiting-on-me
   returns a merged `waiting: []` (keep decide/answer arrays for API back-compat one release, but
   the UI reads `waiting`). Email still NEVER feeds this queue (crisis strip + intake drawer only).
2. **Legacy flag-only cards REMOVED from the glass.** Sessions with needs_attention but NO declared
   ask: (a) if linked to an arc (OracleSession.arc_id, or manifest arc_name resolvable), render a
   quiet ATTENTION DOT on that arc's card in Today strip + Soothsayer (dot + title tooltip
   "session waiting"); (b) unlinked ones appear ONLY on the Fleet screen (unchanged there).
3. **Review grouped**: one card per client (fall back to arc, then "Other") with count + oldest-wait
   age + the top item's title; expanding/peeking shows the individual items (existing peek drawer
   per item). Sorted by oldest wait first. The 13-card wall becomes ~3 group cards.

## E. Meeting prep rule

`MEETING_PREP_MINUTES = 20` beside MEETING_RECOVERY_MINUTES in time-shape-logic: every timed
meeting costs prep before + duration + recovery after. Back-to-back truncation applies to BOTH
(a meeting ending within another's prep window truncates that prep; never double-counted, never
negative). Runway/gap math + week capacity + Soothsayer day-load all use it. Unit tests: normal,
back-to-back, meeting at day start (prep clamped to day start), overlapping meetings.

## Gates

Baselines first; full vitest + tsc + build + FULL Playwright green; new e2e: Soothsayer renders
7 columns + unplanned section + assign-to-day works (persists) + snooze hides an arc from
No-day-assigned; merged Waiting-on-you renders declared asks; review groups expand; attention dot
appears for a linked waiting session. Screenshots: soothsayer desktop + mobile, seeing-stone
post-rework desktop. Commit repo-style incl. this spec + verification record. No push.

## Report

Baselines vs finals, migration evidence, gate results with explicit counts, screenshot paths,
commits, deviations. Note anything about the session-contract (machine-side) that should change
now that decide-vs-answer no longer needs guessing — Bast updates the contract text after deploy.
