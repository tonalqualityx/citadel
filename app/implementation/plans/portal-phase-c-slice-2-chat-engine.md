# Feature: Portal phase C, slice C2 (chat engine)

Spec: `/home/mike/Documents/indelible-ops/specs/client-portal-phase-C-chat-SPEC.md` (sections 2.3 to 2.6, 4, 5, 6, 8, 9.2, 11.2, 11.6, 11.8 row C2).
Branch `portal/c2-chat-engine`, cut from `portal/c1-chat-core` (18144d8). Mode ships OFF; nothing here is client-visible.

## Overview
The consequence layer: `apply.ts` is the ONLY writer of model results (gate, provenance, then actions), plus the
routes the runner and the client call, uploads, the tree-mode fallback and a recorded-response harness. Machine side:
`runner.py`, the MCP tool server `portal_data_mcp.py`, the prompts and the isolation check.

## Impact analysis (done before code)
Codebase:
- `lib/portal/thread.ts` `postClientMessage` is the phase B message path; the work-page POST route gains "open the
  conversation lazily and queue a job when chat is available" (a new wrapper, the function itself is unchanged).
- `lib/portal/chat/context.ts` `renderThread` duplicates a choice's label (client_choice + client_message): one small
  change so a choice comment renders once.
- `lib/portal/waits.ts` gains `openClientReplyWait` (handoff, spec 8); existing exports unchanged.
- `app/api/portal/intake/context` gains `chat` (availability) so the UI can choose chat or stepper.
- `lib/api/registry/*`: new entries for every route (registry test enforces).
- `lib/services/s3.ts`: private put/get next to the existing public upload (no new dependency).
- `/home/mike/.claude/tools/citadel-worker/spawn-gate.py` (+ test): `chat-clarifying` joins `BLOCKING_TAGS`.
Tests: `registry.test.ts` (every route registered); `context.integration.test.ts` (choice rendering);
`thread.test.ts` untouched (function unchanged).

## Files to create
- Citadel lib: `lib/services/uploads.ts`; `lib/portal/chat/{copy,urgent,gate-context,apply,file-early,confirm,handoff,tree-mode,view,jobs,attachments}.ts`
- Routes: `api/engine/jobs/[id]/{complete,fail}`, `api/portal/chat` (+ `[id]`, `[id]/messages|confirm|presence`), `api/portal/uploads`,
  `api/portal/attachments/[id]`, (page routes: built in C1 fix commits, merged later, not built here), `api/tasks/[id]/chat` (+ `hand-back`), `api/attachments/[id]`
- Tests: vitest units (uploads, urgent, copy scan, tree-mode) and real-scratch-DB integration (apply, file-early, confirm,
  handoff, expiry, routes), the recorded-response harness `lib/portal/chat/__tests__/harness/`
- Machine: `portal-chat/{runner.py,portal_data_mcp.py,claude-settings.json,prompts/chat_reply.md,prompts/chat_email_reply.md,tests/}`

## Not in C2
UI (C3), mailer/sweep/inbound/ingest (C4), cron lines and rollout (C5).

## Verification checklist
- [ ] prisma validate; tsc --noEmit; vitest run (full); next build
- [ ] python3 -m unittest discover (portal-chat tests); runner.py --isolation-check exit 0
- [ ] live end-to-end gate (next start on the scratch DB, one real Opus run)
