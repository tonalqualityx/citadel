-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'troubador_run_review_ready';
ALTER TYPE "NotificationType" ADD VALUE 'article_client_approved';
ALTER TYPE "NotificationType" ADD VALUE 'article_client_changes_requested';
ALTER TYPE "NotificationType" ADD VALUE 'interview_answers_submitted';

-- AlterTable
ALTER TABLE "troubador_interviews" ADD COLUMN     "answers" JSONB;
