-- Oracle Projects Tab Phase 5 fixes (HIGH-1/MEDIUM-1) — the approval-sender's server
-- claim. Adds the `sending` ApprovalRequestStatus value (queued -> sending -> sent,
-- claimed by the machine-side sender BEFORE it ever calls gog — see
-- ~/.claude/tools/citadel-approvals/approval-sender.py's module docstring and
-- lib/oracle/projects/blockers.ts's classifyClientApprovals for the 30-minute-stuck
-- surfacing) and the send_attempt_at timestamp that transition stamps. Both additive
-- and idempotent, matching the Phase 1/3/5 convention (guarded DO block for the enum
-- value, ADD COLUMN IF NOT EXISTS for the column) so a re-run of this file
-- (`prisma db execute`) is a clean no-op.

-- AlterEnum, guarded: ALTER TYPE ... ADD VALUE is not itself re-runnable without a
-- guard (a bare second run raises duplicate_object) — checked against pg_enum first,
-- same guarded-DO-block convention this repo already uses for FK/constraint guards.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ApprovalRequestStatus' AND e.enumlabel = 'sending'
    ) THEN
        ALTER TYPE "ApprovalRequestStatus" ADD VALUE 'sending';
    END IF;
END $$;

-- AlterTable: approval_requests — send_attempt_at, stamped by PUT .../sending
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "send_attempt_at" TIMESTAMP(3);
