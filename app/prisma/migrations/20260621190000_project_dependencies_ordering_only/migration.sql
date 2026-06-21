-- Project-level dependency gating toggle.
-- false (default) = approval-gated: a dependent unblocks only once its blocker is done AND approved.
-- true            = ordering-only: a dependent unblocks as soon as its blocker is done.
-- Additive column with a default — reversible, no data loss.
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "dependencies_ordering_only" BOOLEAN NOT NULL DEFAULT false;
