# Feature: Portal phase C, slice C4 (the email leg)

Spec: `/home/mike/Documents/indelible-ops/specs/client-portal-phase-C-chat-SPEC.md` (7, 11.8 row C4). Branch `portal/c4-chat-email`, cut from `portal/c2-chat-engine`. Mode ships OFF.

## Impact analysis (done before code)
Codebase:
- `lib/portal/notices.ts` `queuePortalNotices`: returns early for a task with a chat conversation (its mail goes by the chat lane). `contactCanOpen` and `ContactRow` become exports.
- `lib/portal/chat/apply.ts`: after a `chat_email_reply` result is applied (and after the canned fallback) the reply is emailed by `mailer.ts`. No change to the gate, actions or ordering.
- `lib/portal/waits.ts`: two additions (`onChatAwayEmail`, `onChatClientAnswered`); existing exports unchanged.
- `app/api/email-outbox/*`: list selects `reply_to`, `task_id`; claim re-checks a `portal_chat` recipient; sent accepts `rfc_message_id`, `gmail_thread_id` and updates the conversation's thread bookkeeping.
- `lib/services/email.ts`: `OutboxKind` gains `portal_chat`.
- Machine: `drain_outbox.py` (extend), `email-classifier.py`, inbound `ib_common/ib_flow/inbound_hook`, email-check SKILL.md (skip rules). Backups `.bak-20261022-c4`.
Tests: `lib/portal/__tests__/notices.test.ts` (prisma mock gains `chatConversation.findUnique`), the email-outbox route tests (unchanged, still pass), `inbound/tests/test_flow_and_hook.py::test_backup_exists_and_differs_only_by_the_hook` (pins the classifier diff against the 20261021 backup, so the account_counts line is kept and extended on a new line).

## Files to create
- `lib/portal/chat/{mailer,sweep,inbound,outbox-guard}.ts`
- `app/api/portal-chat/{sweep,inbound,inbound/attachments}/route.ts`
- Tests: `lib/portal/chat/__tests__/email.integration.test.ts`, harness scenarios `walk-away-then-email-reply.json`, `email-from-unknown-sender.json` (harness gains `sweep`, `email` steps and outbox expectations)
- Machine: `portal-chat/ingest_replies.py` + tests, `portal-chat/crontab.lines` (not installed), classifier and inbound skip tests

## Not in C4
Cron install, rollout (C5); C2 review fixes (merged later, `closeUnconfirmed` replaces the sweep's own question-chat close when it lands).

## Verification checklist
- [ ] prisma validate; tsc --noEmit; vitest (portal, api, services, email-outbox); next build
- [ ] unittest: citadel-mail, portal-chat, inbound, classifier
- [ ] live check: one test mail mike@ to bast+c-{token}@ ingested by ingest_replies.py --once into a scratch conversation

## Review fixes (Opus review, 2026-10-22)
Sender parsing (single From, angle address), whole-label DKIM/DMARC alignment, a dedicated `sweep_call.py` cron line, the runner no longer ingests, staff-reply window 7 days with `chat_meta` marking, quoted-history cuts (own frame, five more languages, attached messages), a fixed yes check before `confirm_from_email`, unmatched `bast+c-*` mail (label, inbox, one task a day), chat mail recognised only through the drain's outbound file (ids and tokens) and only on bast@, quarantined posts withdraw their staged files, the away query ordered and filtered in SQL, "Indelible Support" everywhere.

Item 10 (engine route tests sharing a database): one scratch database per worktree. `lib/engine/__tests__/seed.ts` now throws at import when a `citadel-<slug>-wt` worktree runs against a database whose name lacks `<slug>` (c4 uses `citadel_c4_scratch`).
