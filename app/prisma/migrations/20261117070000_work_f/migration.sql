-- Work stage F: the two clocks. One new table (work_clock) and its indexes. Nothing existing is altered, closed or deleted, and no time
-- entry is ever written by a row here: time_entry_id is stamped only by the owner's own Log it tap.

-- CreateTable
CREATE TABLE "work_clock" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "user_id" UUID,
    "target_key" VARCHAR(60),
    "project_id" UUID,
    "task_id" UUID,
    "session_external_id" VARCHAR(255),
    "source" VARCHAR(30) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "agent_minutes" INTEGER,
    "cost_usd" DECIMAL(10,4),
    "model" VARCHAR(20),
    "basis" VARCHAR(300),
    "time_entry_id" UUID,
    "dedupe_key" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_clock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_clock_dedupe_key_key" ON "work_clock"("dedupe_key");

-- CreateIndex
CREATE INDEX "work_clock_target_key_started_at_idx" ON "work_clock"("target_key", "started_at");

-- CreateIndex
CREATE INDEX "work_clock_project_id_started_at_idx" ON "work_clock"("project_id", "started_at");

-- CreateIndex
CREATE INDEX "work_clock_task_id_started_at_idx" ON "work_clock"("task_id", "started_at");
