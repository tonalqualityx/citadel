-- Oracle Projects Tab spec polish (2026-09-04) — distinguishes an original approval
-- request from a follow-up chase drafted off a client_approval blocker's chase_draft
-- (lib/oracle/projects/blockers.ts's classifyClientApprovals). A chase row is created
-- via the SAME POST /api/approval-requests + PATCH .../[id] {status:'queued'} path as
-- any other approval, just with kind:'chase' and the same task_id.
--
-- Additive and idempotent (guarded DO block for the enum, ADD COLUMN IF NOT EXISTS for
-- the column, with a DEFAULT so every pre-existing row backfills to 'approval' for
-- free), matching this repo's own convention so a re-run of this file
-- (`prisma db execute`) is a clean no-op.

-- CreateEnum, guarded (Postgres has no native CREATE TYPE ... IF NOT EXISTS)
DO $$ BEGIN
    CREATE TYPE "ApprovalRequestKind" AS ENUM ('approval', 'chase');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: approval_requests — kind, defaulting every existing row to 'approval'
-- (the only kind that existed before this migration).
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "kind" "ApprovalRequestKind" NOT NULL DEFAULT 'approval';
