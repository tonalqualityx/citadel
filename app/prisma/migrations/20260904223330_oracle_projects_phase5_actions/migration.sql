-- Oracle Projects Tab Phase 5 — actions + the client-approval loop
-- (implementation/plans/oracle-projects-tab.md). Additive-only: six nullable columns on
-- approval_requests, matching the Phase 1/3 idempotent convention (ADD COLUMN IF NOT
-- EXISTS) so a re-run of this file (`prisma db execute`) is a clean no-op — see the
-- plan's Gates section. No new tables — BlockerDismissal and ApprovalRequest themselves
-- already exist from Phase 1; this phase only adds the state-machine timestamps PATCH
-- /api/approval-requests/[id] stamps on each transition, plus the sender's own
-- send_error column.

-- AlterTable: approval_requests — state-machine timestamps + sender error tracking
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "queued_at" TIMESTAMP(3);
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "queued_by_id" UUID;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "changes_requested_at" TIMESTAMP(3);
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "send_error" TEXT;
-- Counts consecutive PUT .../send-error calls since the last successful send (or since
-- this row was last (re-)queued). PUT .../send-error increments it; on the 3rd it also
-- flips status back to 'draft' (so a persistently-failing send stops retrying forever —
-- see approval-sender.py). PUT .../sent and a fresh draft->queued transition both reset
-- it to 0, since each represents a clean new attempt cycle.
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "send_error_count" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey, guarded by a pg_constraint existence check (same convention as Phase 1)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_queued_by_id_fkey') THEN
        ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_queued_by_id_fkey" FOREIGN KEY ("queued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
