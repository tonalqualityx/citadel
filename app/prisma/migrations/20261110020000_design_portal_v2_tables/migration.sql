-- Designer Portal v2 (SPEC 3, W0.4): tracks, jobs, notes, brief, references, markups, art direction, page reviews,
-- imports, edits, track assets. Additive only: new tables, enum values, nullable columns.

-- CreateEnum
CREATE TYPE "DesignPath" AS ENUM ('designer', 'zero_design', 'portal');

-- CreateEnum
CREATE TYPE "DesignTrackStage" AS ENUM ('research', 'art_direction', 'home_build', 'refine', 'rest_build', 'review', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "DesignJobKind" AS ENUM ('provision', 'research', 'capture', 'process_upload', 'brief', 'wireframe', 'home_build', 'rest_build', 'module', 'bulk_import', 'launch_readiness', 'client_brief_email', 'client_review_email', 'fact_fix');

-- CreateEnum
CREATE TYPE "DesignJobStatus" AS ENUM ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DesignCommandVerb" ADD VALUE 'adopt_branch';
ALTER TYPE "DesignCommandVerb" ADD VALUE 'finish_gates';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DesignEventKind" ADD VALUE 'edit';
ALTER TYPE "DesignEventKind" ADD VALUE 'track_stage';
ALTER TYPE "DesignEventKind" ADD VALUE 'art_direction';
ALTER TYPE "DesignEventKind" ADD VALUE 'brief';

-- AlterTable
ALTER TABLE "design_sessions" ADD COLUMN     "track_id" UUID;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "design_path" "DesignPath";

-- CreateTable
CREATE TABLE "design_tracks" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "slug" CHAR(16) NOT NULL,
    "stage" "DesignTrackStage" NOT NULL DEFAULT 'research',
    "branch" VARCHAR(100) NOT NULL,
    "preview_alias" VARCHAR(100) NOT NULL,
    "preview_url" VARCHAR(300),
    "preview_sha" VARCHAR(64),
    "head_sha" VARCHAR(64),
    "brief_id" UUID,
    "art_direction_id" UUID,
    "busy_job_id" UUID,
    "finish_command_id" UUID,
    "finish_result" JSONB,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_jobs" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "kind" "DesignJobKind" NOT NULL,
    "status" "DesignJobStatus" NOT NULL DEFAULT 'queued',
    "task_id" UUID,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "not_before" TIMESTAMP(3),
    "claimed_by" VARCHAR(100),
    "lease_until" TIMESTAMP(3),
    "command_id" UUID,
    "cost_usd" DECIMAL(10,4),
    "log_asset_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_notes" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "project_id" UUID,
    "site_id" UUID,
    "source_kind" VARCHAR(20) NOT NULL,
    "source_ref" VARCHAR(300) NOT NULL,
    "source_date" TIMESTAMP(3) NOT NULL,
    "speaker_name" VARCHAR(200) NOT NULL,
    "speaker_role" VARCHAR(20) NOT NULL,
    "quote" TEXT NOT NULL,
    "quote_sha" CHAR(64) NOT NULL,
    "is_paraphrase" BOOLEAN NOT NULL DEFAULT false,
    "category" VARCHAR(30) NOT NULL,
    "polarity" VARCHAR(10) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "reference_url" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'active',
    "superseded_by_id" UUID,
    "confidence" DOUBLE PRECISION NOT NULL,
    "extracted_by" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_briefs" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "body" JSONB NOT NULL,
    "job_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_brief_reactions" (
    "id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "card_id" VARCHAR(40) NOT NULL,
    "reaction" VARCHAR(14) NOT NULL,
    "note" VARCHAR(200),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_brief_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_references" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "url" VARCHAR(500),
    "title" VARCHAR(200) NOT NULL,
    "why_md" TEXT,
    "decision" VARCHAR(8) NOT NULL DEFAULT 'pending',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "capture_status" VARCHAR(10) NOT NULL DEFAULT 'none',
    "capture_error" VARCHAR(500),
    "desktop_fold_asset_id" UUID,
    "desktop_full_asset_id" UUID,
    "phone_fold_asset_id" UUID,
    "phone_full_asset_id" UUID,
    "upload_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "extracted" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_markups" (
    "id" UUID NOT NULL,
    "reference_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "rect" JSONB NOT NULL,
    "sentiment" VARCHAR(8) NOT NULL,
    "category" VARCHAR(12) NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_markups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_art_directions" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "body" JSONB NOT NULL,
    "drafted_by" VARCHAR(8) NOT NULL,
    "signed_by_id" UUID,
    "signed_at" TIMESTAMP(3),
    "client_email_job_id" UUID,
    "client_email_status" VARCHAR(8),
    "client_email_sent_at" TIMESTAMP(3),
    "client_email_held_reason" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_art_directions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_page_reviews" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "page_path" VARCHAR(300) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'not_opened',
    "first_opened_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_change_at" TIMESTAMP(3),
    "changed_after_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "approval_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "latest_shot_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "requirement_id" VARCHAR(64),
    "import_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_page_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_imports" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "template_page_path" VARCHAR(300) NOT NULL,
    "source_paths" TEXT[],
    "mapping_path" VARCHAR(300),
    "expected_count" INTEGER NOT NULL,
    "skipped_count" INTEGER,
    "generated_count" INTEGER,
    "required_for_launch" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "job_id" UUID,
    "spot_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "released_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_edits" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "client_ref" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "page_path" VARCHAR(300) NOT NULL,
    "target" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'queued',
    "change_id" UUID,
    "error" VARCHAR(2000),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_track_assets" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "parent_asset_id" UUID,
    "purpose" VARCHAR(8),
    "status" VARCHAR(10) NOT NULL DEFAULT 'ready',
    "reject_reason" VARCHAR(300),
    "content_type" VARCHAR(40) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "page" INTEGER,
    "page_path" VARCHAR(300),
    "viewport_w" INTEGER,
    "original_name" VARCHAR(120),
    "storage_key" VARCHAR(200) NOT NULL,
    "source" VARCHAR(8) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_track_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "design_tracks_slug_key" ON "design_tracks"("slug");

-- CreateIndex
CREATE INDEX "design_tracks_project_id_idx" ON "design_tracks"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_tracks_site_id_round_key" ON "design_tracks"("site_id", "round");

-- CreateIndex
CREATE INDEX "design_jobs_status_not_before_created_at_idx" ON "design_jobs"("status", "not_before", "created_at");

-- CreateIndex
CREATE INDEX "design_jobs_track_id_kind_idx" ON "design_jobs"("track_id", "kind");

-- CreateIndex
CREATE INDEX "design_notes_client_id_status_idx" ON "design_notes"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_notes_client_id_source_ref_quote_sha_key" ON "design_notes"("client_id", "source_ref", "quote_sha");

-- CreateIndex
CREATE UNIQUE INDEX "design_briefs_track_id_version_key" ON "design_briefs"("track_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "design_brief_reactions_brief_id_card_id_created_by_id_key" ON "design_brief_reactions"("brief_id", "card_id", "created_by_id");

-- CreateIndex
CREATE INDEX "design_references_track_id_sort_order_idx" ON "design_references"("track_id", "sort_order");

-- CreateIndex
CREATE INDEX "design_markups_reference_id_idx" ON "design_markups"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_art_directions_client_email_job_id_key" ON "design_art_directions"("client_email_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_art_directions_track_id_version_key" ON "design_art_directions"("track_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "design_page_reviews_track_id_page_path_key" ON "design_page_reviews"("track_id", "page_path");

-- CreateIndex
CREATE UNIQUE INDEX "design_imports_task_id_key" ON "design_imports"("task_id");

-- CreateIndex
CREATE INDEX "design_imports_track_id_template_page_path_idx" ON "design_imports"("track_id", "template_page_path");

-- CreateIndex
CREATE INDEX "design_edits_session_id_status_idx" ON "design_edits"("session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_edits_session_id_client_ref_key" ON "design_edits"("session_id", "client_ref");

-- CreateIndex
CREATE INDEX "design_track_assets_track_id_kind_idx" ON "design_track_assets"("track_id", "kind");

-- CreateIndex
CREATE INDEX "design_track_assets_parent_asset_id_idx" ON "design_track_assets"("parent_asset_id");

-- CreateIndex
CREATE INDEX "design_sessions_track_id_idx" ON "design_sessions"("track_id");

-- AddForeignKey
ALTER TABLE "design_sessions" ADD CONSTRAINT "design_sessions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_tracks" ADD CONSTRAINT "design_tracks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_tracks" ADD CONSTRAINT "design_tracks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_jobs" ADD CONSTRAINT "design_jobs_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_jobs" ADD CONSTRAINT "design_jobs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_notes" ADD CONSTRAINT "design_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_notes" ADD CONSTRAINT "design_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_notes" ADD CONSTRAINT "design_notes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_notes" ADD CONSTRAINT "design_notes_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "design_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "design_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_brief_reactions" ADD CONSTRAINT "design_brief_reactions_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "design_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_brief_reactions" ADD CONSTRAINT "design_brief_reactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_references" ADD CONSTRAINT "design_references_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_references" ADD CONSTRAINT "design_references_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_markups" ADD CONSTRAINT "design_markups_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "design_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_markups" ADD CONSTRAINT "design_markups_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "design_track_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_markups" ADD CONSTRAINT "design_markups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_art_directions" ADD CONSTRAINT "design_art_directions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_art_directions" ADD CONSTRAINT "design_art_directions_signed_by_id_fkey" FOREIGN KEY ("signed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_page_reviews" ADD CONSTRAINT "design_page_reviews_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_page_reviews" ADD CONSTRAINT "design_page_reviews_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_page_reviews" ADD CONSTRAINT "design_page_reviews_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "design_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_imports" ADD CONSTRAINT "design_imports_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_imports" ADD CONSTRAINT "design_imports_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_edits" ADD CONSTRAINT "design_edits_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_edits" ADD CONSTRAINT "design_edits_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "design_changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_edits" ADD CONSTRAINT "design_edits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_track_assets" ADD CONSTRAINT "design_track_assets_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "design_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_track_assets" ADD CONSTRAINT "design_track_assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "design_track_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_track_assets" ADD CONSTRAINT "design_track_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Partial unique indexes (raw SQL, like design_sessions_one_live_per_task in v1)
CREATE UNIQUE INDEX "design_sessions_one_live_per_track"
  ON "design_sessions" ("track_id")
  WHERE "track_id" IS NOT NULL AND "status" NOT IN ('closed', 'abandoned');

CREATE UNIQUE INDEX "design_tracks_one_open_per_site"
  ON "design_tracks" ("site_id")
  WHERE "stage" NOT IN ('done', 'cancelled');

CREATE UNIQUE INDEX "design_jobs_one_active_build_per_track"
  ON "design_jobs" ("track_id")
  WHERE "kind" IN ('home_build', 'rest_build') AND "status" IN ('queued', 'claimed', 'running');

CREATE UNIQUE INDEX "design_references_one_url_per_track"
  ON "design_references" ("track_id", "url")
  WHERE "url" IS NOT NULL;

CREATE UNIQUE INDEX "design_art_directions_one_draft"
  ON "design_art_directions" ("track_id")
  WHERE "status" = 'draft';
