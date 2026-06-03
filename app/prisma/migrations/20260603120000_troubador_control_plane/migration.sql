-- CreateEnum
CREATE TYPE "TroubadorRunStage" AS ENUM ('planning', 'topic_selection', 'researching', 'ready_for_interview', 'in_production', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('pending_research', 'researched', 'drafting', 'in_review', 'needs_revision', 'approved', 'scheduled', 'published', 'postponed', 'dropped');

-- CreateEnum
CREATE TYPE "ArticleCheckState" AS ENUM ('pending', 'passed', 'check_failed', 'compliance_hold');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('pending', 'in_progress', 'complete');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('eleventy', 'wordpress');

-- CreateEnum
CREATE TYPE "TopicArchetype" AS ENUM ('pillar', 'thought_leadership', 'case_study', 'how_to', 'commodity');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'article_needs_review';
ALTER TYPE "NotificationType" ADD VALUE 'troubador_run_created';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "content_dir" VARCHAR(255),
ADD COLUMN     "repo_branch" VARCHAR(100),
ADD COLUMN     "repo_url" VARCHAR(500),
ADD COLUMN     "site_type" "SiteType",
ADD COLUMN     "wp_base_url" VARCHAR(500),
ADD COLUMN     "wp_default_author" VARCHAR(255),
ADD COLUMN     "wp_default_category" VARCHAR(255);

-- CreateTable
CREATE TABLE "troubador_schedules" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'active',
    "target_article_count" INTEGER NOT NULL DEFAULT 4,
    "publish_per_week" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "lead_time_days" INTEGER NOT NULL DEFAULT 7,
    "overarching_goals" TEXT,
    "default_assignee_id" UUID,
    "allow_concurrent" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMP(3) NOT NULL,
    "skip_next" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "troubador_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubador_runs" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "schedule_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "stage" "TroubadorRunStage" NOT NULL DEFAULT 'planning',
    "brief" TEXT,
    "goal_type" VARCHAR(50),
    "target_offering" VARCHAR(255),
    "must_cover" TEXT,
    "avoid" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "selection_ready" BOOLEAN NOT NULL DEFAULT false,
    "assignee_id" UUID,
    "claimed_at" TIMESTAMP(3),
    "claimed_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "troubador_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubador_topic_proposals" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "archetype" "TopicArchetype",
    "primary_keyword" VARCHAR(255),
    "search_volume" INTEGER,
    "keyword_difficulty" INTEGER,
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'troubador',
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "saved_for_later" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "troubador_topic_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubador_articles" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'pending_research',
    "check_state" "ArticleCheckState" NOT NULL DEFAULT 'pending',
    "check_report" JSONB,
    "research_summary" TEXT,
    "body" TEXT,
    "social_copy" TEXT,
    "suggested_date" TIMESTAMP(3),
    "scheduled_date" TIMESTAMP(3),
    "published_url" VARCHAR(500),
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "claimed_at" TIMESTAMP(3),
    "claimed_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "troubador_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubador_article_comments" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "user_id" UUID,
    "content" TEXT NOT NULL,
    "is_feedback" BOOLEAN NOT NULL DEFAULT true,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "troubador_article_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubador_interviews" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'pending',
    "questions" JSONB,
    "transcript" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "troubador_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "troubador_schedules_client_id_idx" ON "troubador_schedules"("client_id");

-- CreateIndex
CREATE INDEX "troubador_schedules_site_id_idx" ON "troubador_schedules"("site_id");

-- CreateIndex
CREATE INDEX "troubador_schedules_status_idx" ON "troubador_schedules"("status");

-- CreateIndex
CREATE INDEX "troubador_schedules_default_assignee_id_idx" ON "troubador_schedules"("default_assignee_id");

-- CreateIndex
CREATE INDEX "troubador_runs_client_id_idx" ON "troubador_runs"("client_id");

-- CreateIndex
CREATE INDEX "troubador_runs_site_id_idx" ON "troubador_runs"("site_id");

-- CreateIndex
CREATE INDEX "troubador_runs_schedule_id_idx" ON "troubador_runs"("schedule_id");

-- CreateIndex
CREATE INDEX "troubador_runs_stage_idx" ON "troubador_runs"("stage");

-- CreateIndex
CREATE INDEX "troubador_runs_assignee_id_idx" ON "troubador_runs"("assignee_id");

-- CreateIndex
CREATE INDEX "troubador_topic_proposals_run_id_idx" ON "troubador_topic_proposals"("run_id");

-- CreateIndex
CREATE INDEX "troubador_articles_run_id_idx" ON "troubador_articles"("run_id");

-- CreateIndex
CREATE INDEX "troubador_articles_client_id_idx" ON "troubador_articles"("client_id");

-- CreateIndex
CREATE INDEX "troubador_articles_site_id_idx" ON "troubador_articles"("site_id");

-- CreateIndex
CREATE INDEX "troubador_articles_status_idx" ON "troubador_articles"("status");

-- CreateIndex
CREATE INDEX "troubador_articles_scheduled_date_idx" ON "troubador_articles"("scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "troubador_articles_run_id_slug_key" ON "troubador_articles"("run_id", "slug");

-- CreateIndex
CREATE INDEX "troubador_article_comments_article_id_idx" ON "troubador_article_comments"("article_id");

-- CreateIndex
CREATE INDEX "troubador_article_comments_created_at_idx" ON "troubador_article_comments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "troubador_interviews_run_id_key" ON "troubador_interviews"("run_id");

-- AddForeignKey
ALTER TABLE "troubador_schedules" ADD CONSTRAINT "troubador_schedules_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_schedules" ADD CONSTRAINT "troubador_schedules_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_schedules" ADD CONSTRAINT "troubador_schedules_default_assignee_id_fkey" FOREIGN KEY ("default_assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_runs" ADD CONSTRAINT "troubador_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_runs" ADD CONSTRAINT "troubador_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_runs" ADD CONSTRAINT "troubador_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "troubador_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_runs" ADD CONSTRAINT "troubador_runs_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_topic_proposals" ADD CONSTRAINT "troubador_topic_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "troubador_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_articles" ADD CONSTRAINT "troubador_articles_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "troubador_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_articles" ADD CONSTRAINT "troubador_articles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_articles" ADD CONSTRAINT "troubador_articles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_articles" ADD CONSTRAINT "troubador_articles_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_article_comments" ADD CONSTRAINT "troubador_article_comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "troubador_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_article_comments" ADD CONSTRAINT "troubador_article_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubador_interviews" ADD CONSTRAINT "troubador_interviews_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "troubador_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

