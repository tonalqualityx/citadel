-- Designer portal: tables, enums, and the two partial unique indexes Prisma cannot express.

-- CreateEnum
CREATE TYPE "DesignSessionStatus" AS ENUM ('pending', 'active', 'awaiting_input', 'paused_budget', 'stopped', 'publishing', 'closed', 'abandoned');

-- CreateEnum
CREATE TYPE "DesignPublishKind" AS ENUM ('publish', 'rollback');

-- CreateEnum
CREATE TYPE "DesignPublishStatus" AS ENUM ('awaiting_confirmation', 'expired', 'queued', 'running', 'published', 'blocked_gates', 'blocked_policy', 'conflict', 'failed', 'rolled_back');

-- CreateEnum
CREATE TYPE "DesignEventRole" AS ENUM ('designer', 'assistant', 'tool', 'system');

-- CreateEnum
CREATE TYPE "DesignEventKind" AS ENUM ('text', 'apply', 'thought', 'action', 'result', 'screenshot', 'gate', 'cost', 'plan', 'status', 'scope', 'change', 'publish');

-- CreateEnum
CREATE TYPE "DesignPinStatus" AS ENUM ('pending', 'sent', 'resolved', 'out_of_scope', 'discarded');

-- CreateEnum
CREATE TYPE "DesignChangeDecision" AS ENUM ('pending', 'accepted', 'denied');

-- CreateEnum
CREATE TYPE "DesignCommandVerb" AS ENUM ('stop', 'publish', 'rollback', 'restore', 'close', 'resume');

-- CreateEnum
CREATE TYPE "DesignCommandStatus" AS ENUM ('pending', 'claimed', 'done', 'failed');

-- CreateTable
CREATE TABLE "design_sessions" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "project_id" UUID,
    "designer_id" UUID NOT NULL,
    "status" "DesignSessionStatus" NOT NULL DEFAULT 'pending',
    "branch" VARCHAR(100) NOT NULL,
    "preview_alias" VARCHAR(100) NOT NULL,
    "worktree_path" VARCHAR(500),
    "base_sha" VARCHAR(64),
    "head_sha" VARCHAR(64),
    "preview_url" VARCHAR(500),
    "preview_deploy_url" VARCHAR(500),
    "preview_sha" VARCHAR(64),
    "sdk_session_id" VARCHAR(100),
    "model" VARCHAR(60) NOT NULL,
    "effort" VARCHAR(10) NOT NULL DEFAULT 'high',
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "budget_usd" DECIMAL(10,2) NOT NULL,
    "live_text" TEXT,
    "live_action" VARCHAR(200),
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_turn_at" TIMESTAMP(3),
    "lib_index" JSONB,
    "diff_summary" JSONB,
    "diff_asset_id" UUID,
    "publish_requested_at" TIMESTAMP(3),
    "publish_requested_by" UUID,
    "last_publish_id" UUID,
    "publish_precheck" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "design_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "DesignEventRole" NOT NULL,
    "kind" "DesignEventKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "author_id" UUID,
    "client_ref" VARCHAR(64),
    "turn" INTEGER,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_pins" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "status" "DesignPinStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "page_path" VARCHAR(500) NOT NULL,
    "data_lib" VARCHAR(100),
    "lib_stack" VARCHAR(100)[] DEFAULT ARRAY[]::VARCHAR(100)[],
    "data_shape" VARCHAR(50),
    "selector" VARCHAR(500) NOT NULL,
    "text_quote" VARCHAR(200),
    "bbox" JSONB NOT NULL,
    "viewport_width" INTEGER NOT NULL,
    "viewport_height" INTEGER,
    "preview_sha" VARCHAR(64),
    "crop_asset_id" UUID,
    "apply_event_seq" INTEGER,
    "scope_task_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_changes" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "apply_event_seq" INTEGER,
    "commit_sha" VARCHAR(64) NOT NULL,
    "parent_sha" VARCHAR(64),
    "summary" VARCHAR(500) NOT NULL,
    "files" VARCHAR(300)[] DEFAULT ARRAY[]::VARCHAR(300)[],
    "data_libs" VARCHAR(100)[] DEFAULT ARRAY[]::VARCHAR(100)[],
    "pages" VARCHAR(300)[] DEFAULT ARRAY[]::VARCHAR(300)[],
    "render_count" INTEGER,
    "pin_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "before_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "after_asset_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "gates" JSONB,
    "is_restore" BOOLEAN NOT NULL DEFAULT false,
    "restored_from" VARCHAR(64),
    "decision" "DesignChangeDecision" NOT NULL DEFAULT 'pending',
    "designer_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_commands" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "verb" "DesignCommandVerb" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "DesignCommandStatus" NOT NULL DEFAULT 'pending',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "design_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_assets" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "storage_key" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_publishes" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "kind" "DesignPublishKind" NOT NULL DEFAULT 'publish',
    "rolls_back_id" UUID,
    "actor_id" UUID NOT NULL,
    "actor_role" VARCHAR(20) NOT NULL,
    "publish_mode" VARCHAR(20) NOT NULL,
    "main_role" VARCHAR(20) NOT NULL,
    "site_designer_publish" BOOLEAN NOT NULL,
    "confirmation_shown" JSONB,
    "confirmation_token_hash" VARCHAR(64),
    "confirmation_expires_at" TIMESTAMP(3),
    "confirmation_typed" VARCHAR(100),
    "confirm_requested_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "status" "DesignPublishStatus" NOT NULL DEFAULT 'queued',
    "head_sha" VARCHAR(64),
    "from_main_sha" VARCHAR(64),
    "result_sha" VARCHAR(64),
    "deploy_id" VARCHAR(128),
    "deploy_url" VARCHAR(500),
    "alias_url" VARCHAR(500),
    "gates" JSONB,
    "policy" JSONB,
    "diff_summary" JSONB,
    "change_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "cost_usd" DECIMAL(10,4),
    "error" TEXT,
    "notified_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "design_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "monthly_cap_usd" DECIMAL(10,2),
    "session_raise_cap_usd" DECIMAL(10,2),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_portal_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" UUID,
    "designer_publish_mode" VARCHAR(20) NOT NULL DEFAULT 'per_site',
    "confirmation_ttl_minutes" INTEGER NOT NULL DEFAULT 10,
    "default_session_budget_usd" DECIMAL(10,2) NOT NULL DEFAULT 25,
    "designer_raise_cap_usd" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "hard_session_cap_usd" DECIMAL(10,2) NOT NULL DEFAULT 150,
    "default_monthly_cap_usd" DECIMAL(10,2),
    "model" VARCHAR(60) NOT NULL DEFAULT 'opus',
    "effort" VARCHAR(10) NOT NULL DEFAULT 'high',
    "idle_close_minutes" INTEGER NOT NULL DEFAULT 10,
    "max_live_sessions" INTEGER NOT NULL DEFAULT 4,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_portal_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_worker_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_heartbeat_at" TIMESTAMP(3),
    "version" VARCHAR(40),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_reason" VARCHAR(100),
    "configured_site_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "site_main_roles" JSONB,
    "live_sessions" INTEGER NOT NULL DEFAULT 0,
    "sdk_version" VARCHAR(40),

    CONSTRAINT "design_worker_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_sessions_designer_id_status_idx" ON "design_sessions"("designer_id", "status");

-- CreateIndex
CREATE INDEX "design_sessions_site_id_idx" ON "design_sessions"("site_id");

-- CreateIndex
CREATE INDEX "design_sessions_status_last_heartbeat_at_idx" ON "design_sessions"("status", "last_heartbeat_at");

-- CreateIndex
CREATE INDEX "design_events_session_id_role_delivered_at_idx" ON "design_events"("session_id", "role", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_events_session_id_seq_key" ON "design_events"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "design_events_session_id_client_ref_key" ON "design_events"("session_id", "client_ref");

-- CreateIndex
CREATE INDEX "design_pins_session_id_status_idx" ON "design_pins"("session_id", "status");

-- CreateIndex
CREATE INDEX "design_changes_session_id_decision_idx" ON "design_changes"("session_id", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "design_changes_session_id_commit_sha_key" ON "design_changes"("session_id", "commit_sha");

-- CreateIndex
CREATE INDEX "design_commands_status_created_at_idx" ON "design_commands"("status", "created_at");

-- CreateIndex
CREATE INDEX "design_commands_session_id_status_idx" ON "design_commands"("session_id", "status");

-- CreateIndex
CREATE INDEX "design_assets_session_id_kind_idx" ON "design_assets"("session_id", "kind");

-- CreateIndex
CREATE INDEX "design_publishes_site_id_status_finished_at_idx" ON "design_publishes"("site_id", "status", "finished_at");

-- CreateIndex
CREATE INDEX "design_publishes_session_id_created_at_idx" ON "design_publishes"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_budgets_user_id_key" ON "design_budgets"("user_id");

-- AddForeignKey
ALTER TABLE "design_sessions" ADD CONSTRAINT "design_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_sessions" ADD CONSTRAINT "design_sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_sessions" ADD CONSTRAINT "design_sessions_designer_id_fkey" FOREIGN KEY ("designer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_events" ADD CONSTRAINT "design_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_pins" ADD CONSTRAINT "design_pins_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_changes" ADD CONSTRAINT "design_changes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_commands" ADD CONSTRAINT "design_commands_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_publishes" ADD CONSTRAINT "design_publishes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "design_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One live session per task, as a database fact.
CREATE UNIQUE INDEX "design_sessions_one_live_per_task"
  ON "design_sessions" ("task_id")
  WHERE "status" NOT IN ('closed', 'abandoned');

-- One queued or running publish per site, as a database fact.
CREATE UNIQUE INDEX "design_publishes_one_running_per_site"
  ON "design_publishes" ("site_id")
  WHERE "status" IN ('queued', 'running');
