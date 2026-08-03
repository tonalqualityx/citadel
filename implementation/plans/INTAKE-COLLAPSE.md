# Feature: Intake collapse (threads, series, and the lane bug)

Built 2026-08-03 during the Monday ritual, from Mike's ask: "there are a lot of emails in
my intake. Too many, in fact. However, a lot of them are all actually in one thread. If we
could show the thread instead of each individual email, with a summary of the thread with a
way to see how many new items, as well as a note about the most recent one, that would be
handy. And potentially score it on priority?"

## The measured problem

Against the live drawer that morning:

| | count |
|---|---|
| messages rendered as rows | 46 |
| distinct threads | 23 |
| messages in ONE ow-staff thread | 24 (52% of the drawer) |
| lanes reported | `admin: 0, general: 46, meeting: 0, sales: 0` |

Two separate defects, one visible and one hidden.

## Defect 1 (hidden): the lane system had no input

Every intake item was landing in `general`. The lane logic in
`app/api/waiting-on-me/route.ts` and `intake-drawer-logic.ts` was correct. The **producer**
was not: `~/.claude/tools/oracle/clarity/email-classifier.py` never supplied `intent`.

- The heuristic funnel (`_heuristic_classify`) decides most surfaced mail without the model
  — self-sent, Bast's own digests, the accountant, payroll, money subjects, Otherworld —
  and returned a bare category with **no intent at all**. Its keelercpa branch even carried
  the stale note `admin lane pending Citadel ship`: the admin lane shipped in Phase 6b and
  this producer was never updated.
- `intent` was **absent from `CLASSIFY_JSON_SCHEMA`'s `required` list**, so model-classified
  items could omit it, and in practice did. 45 of 46 live items had `intent: null`.

Fixed by adding `_heuristic_intent()` (mirrors `_heuristic_classify`'s rule order) and
making `intent` required in the schema. Money/accountant/payroll now land in `admin` — the
don't-get-paid lane Phase 6b was built for.

## Defect 2 (visible): one row per message

Collapse needs to be TWO different operations. Conflating them gets one wrong:

- **thread** — many messages, one `thread_id`. A conversation. Signal is the **opening**
  message; later messages are the chorus. Anchor = oldest.
- **series** — many messages, MANY `thread_id`s, an automated sender repeating one report
  ("Saiph triage digest — Jul 31 / Aug 1 / Aug 2 / Aug 3"). Thread grouping does nothing
  for these. Signal is the **latest** instalment; earlier ones are superseded. Anchor =
  newest.

Every group also carries `newest` regardless, because Mike asked for both the thing he must
see and a note on most recent activity.

Result on the real payload: **46 messages → 18 rows**, nothing dropped.

## Files changed

- [x] `~/.claude/tools/oracle/clarity/email-classifier.py` — `_heuristic_intent()`; intent
      required in `CLASSIFY_JSON_SCHEMA`. **Live cron, in effect on next pass.** Backup at
      `scratchpad/email-classifier.py.bak`.
- [x] `components/domain/oracle/intake/intake-drawer-logic.ts` — `collapseAsks`,
      `collapseSummaryLine`, `seriesStem`, `CollapsedGroup`, `CollapsibleAsk`. Purely
      additive; no existing export changed.
- [x] `components/domain/oracle/intake/IntakeDrawer.tsx` — renders one card per collapsed
      group; `CollapsedMembers` expander; Archive/Dismiss act on the WHOLE group.
- [x] `components/domain/oracle/intake/__tests__/intake-drawer-logic.test.ts` — +17
- [x] `components/domain/oracle/intake/__tests__/IntakeDrawer.test.tsx` — +5

## Verification (executed, not asserted)

- `npx tsc --noEmit` — exit 0
- `npx vitest run` — **2386 passed**, 203 files (baseline before this work: 2363). Zero failures.
- `npx eslint components/domain/oracle/intake/` — clean
- classifier `--dry-run` — exit 0
- 14-case intent check against the REAL senders in the live drawer — 14/14
- `collapseAsks` run over the REAL 46-item payload — 46 → 18, no message dropped or duplicated

Caveat worth stating: the classifier dry-run had zero new mail on both accounts, so it
proves the module doesn't crash, not that a live pass writes `intent`. The 14-case check is
what covers the mapping. First real pass with new mail is the confirming observation.

Note on process: the repo CLAUDE.md mandates sub-agent impact analysis. This session was
instructed not to spawn agents, so impact analysis was done directly — consumers of
`intake-drawer-logic` (IntakeDrawer, IntakeAttachPicker, its own tests) and of the intake
payload were enumerated before writing. The nullable `thread_id` on `EmailAsk` was caught
that way and is handled (null never groups).

## NOT built — open decisions for Mike

1. **Priority scoring / a must-act lane.** Mike said "potentially score it." Deliberately
   not guessed at. The argument against a score: the classifier got the North Star backup
   warning RIGHT — it was labelled "needs your call" — and it drowned anyway, inside an
   undifferentiated 46-item list. Ranking inside one long list would not have saved it.
   What would: a structurally separate must-act lane, capped at a handful. That is a
   product decision, not an implementation detail.
2. **Gist for heuristic-decided items.** Heuristic items carry no `gist`, so their cards
   fall back to the subject. Fixing it means sending them to the model purely for a
   one-line summary — real token cost on a 15-minute cron. Mike's call.
3. **The money-receipt rule.** `MONEY_SUBJECT_RE` fires on "Payment received", which is a
   receipt, not a request. The MONEY RULE (2026-07-27) says invoices and payment requests
   are always surfaced; receipts arguably are not requests. Nine of 23 threads that morning
   were money paperwork.
4. **QuickBooks receipt collapse.** `seriesStem` strips `#\d+`, so two Vermont Standard
   receipts collapse into one row while different clients stay separate. Defensible, but it
   does mean a row can stand for two clients' payments. Reversible by dropping that rule.
