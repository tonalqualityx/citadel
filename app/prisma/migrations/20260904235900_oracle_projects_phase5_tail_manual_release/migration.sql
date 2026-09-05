-- Oracle Projects Tab Phase 5 tail fixes (MEDIUM-A) — the two Mike-gated PATCH
-- transitions out of a stuck 'sending' row (sending -> sent with confirmed_by_mike, and
-- sending -> draft with release_stuck; see app/api/approval-requests/[id]/route.ts and
-- lib/oracle/projects/blockers.ts's "Approval send unconfirmed" blocker). Adds only the
-- manual_release_at timestamp the release_stuck path stamps — send_attempt_at already
-- exists (Phase 5 fixes migration, 20260904231500) and 'sent'/'draft' are pre-existing
-- ApprovalRequestStatus values, so no enum change is needed here. Additive and
-- idempotent (ADD COLUMN IF NOT EXISTS), matching this repo's own convention so a re-run
-- of this file (`prisma db execute`) is a clean no-op.

ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "manual_release_at" TIMESTAMP(3);
