-- Fleet item 1: engagement owner briefs and passes. Additive only (two new tables).
CREATE TABLE "engagement_briefs" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "project_id" UUID,
    "charter_id" UUID,
    "label" VARCHAR(120) NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "allowed_actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "release_owner_role" VARCHAR(40) NOT NULL DEFAULT 'pm',
    "stall_rules" JSONB NOT NULL DEFAULT '{}',
    "owner_mode" VARCHAR(10) NOT NULL DEFAULT 'off',
    "cadence" VARCHAR(40) NOT NULL DEFAULT 'weekly',
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_pass_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_briefs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engagement_passes" (
    "id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "model" VARCHAR(80),
    "cost_usd" DECIMAL(8,4),
    "tasks_read" INTEGER NOT NULL DEFAULT 0,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "mike_items" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "engagement_passes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engagement_briefs_project_id_key" ON "engagement_briefs"("project_id");
CREATE UNIQUE INDEX "engagement_briefs_charter_id_key" ON "engagement_briefs"("charter_id");
CREATE INDEX "engagement_briefs_owner_mode_idx" ON "engagement_briefs"("owner_mode");
CREATE INDEX "engagement_passes_brief_id_started_at_idx" ON "engagement_passes"("brief_id", "started_at");
