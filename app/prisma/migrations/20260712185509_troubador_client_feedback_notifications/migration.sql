-- Reconciliation migration (not authored by Clarity Phase 1): this migration was already
-- applied to the shared local dev DB (localhost:5433/citadel_dev) by unrelated, unmerged
-- work before this worktree started — its folder never made it into the main tree or any
-- feature branch's git history. Recreated here, verbatim to the live DB state, purely so
-- this worktree's migration history reconciles with reality without a `migrate reset`
-- (forbidden by the Clarity Phase 1 hard rules). No new DDL beyond what already exists.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'troubador_run_review_ready';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'article_client_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'article_client_changes_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'interview_answers_submitted';

-- AlterTable
ALTER TABLE "troubador_interviews" ADD COLUMN IF NOT EXISTS "answers" JSONB;
