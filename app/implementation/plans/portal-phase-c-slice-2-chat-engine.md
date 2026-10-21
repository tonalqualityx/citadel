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

## Review fixes (Opus review of C2)
1. `gateAll` gates every client-visible model field (`GATED_FIELDS` in `apply.ts`); a vitest enumerates the Zod schema's string fields against the gated, id-validated and internal-only lists. Spec 9.2 updated.
2. `chat-clarifying` is dropped on handoff and on an urgent press (hand-back puts it back while unconfirmed). `closeUnconfirmed` / `sweepUnconfirmed` in `confirm.ts` are the hook C4's sweep calls: question chats close as done after 24 h, unconfirmed requests are filed with what is known after 48 h (`unconfirmed-chat` + `needs-mike`).
3. `expireStaleJobs` is one `UPDATE ... RETURNING`: the lease and queue conditions are in the write, only rows it changed are returned, and only their conversations go to tree mode.
4. The isolation hash set now covers `runner.py`, both `chat_*.md` templates and `voice.md`.
5. The tool server asks `GET /api/engine/jobs/:id/tool-quota` before it spends a Google call; exception text goes to `~/.local/log/portal-data-mcp.log`, never to the model or Citadel.
6. One lease number: Citadel's lease is 120 s plus two 60 s heartbeats (240 s). The runner's `JOB_BUDGET_S` is 225 s for both runs and the posts; the regeneration gets only what is left, or the canned fallback when under 30 s remains.
7. Uploads: PDFs with `/JavaScript`, `/JS`, `/OpenAction`, `/Launch`, `/AA`, `/RichMedia`, `/XFA` are refused (hex-obfuscated names decoded first); a file binds only to its own uploader's message; the model can name only this conversation's files.
8. Harness: a refused result carrying `hand_to_person` + `record` + `suggest_urgent` changes no tag, slot or wait.

### Bucket policy check (rollout step, before mode pilot)
`uploadToS3` (the staff `/api/uploads` route) returns a PUBLIC URL under `uploads/`, so the bucket may allow public read. Client files therefore live under a separate prefix, `portal-private/`, written with no ACL (`assertPrivateKey` refuses `uploads/`, `public/` and traversal). The bucket policy must grant anonymous read on `uploads/*` ONLY. Prove it on the deployed bucket with `verifyPrivateNotPublic()` in `lib/services/s3.ts`: it writes one fixed probe object under `portal-private/__probe__/` with the app's credentials and fetches it anonymously; it passes only on a 403/401 (a 404 or 200 fails). A probe on a missing key proves nothing, because a public-read bucket answers 403 for a key that does not exist. Without S3 the files go to `PORTAL_UPLOAD_DIR` outside the deploy path and are served only through the two authenticated routes.
