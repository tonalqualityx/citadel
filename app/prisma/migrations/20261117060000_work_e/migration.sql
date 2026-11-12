-- Work stage E: sessions. Two nullable columns on oracle_sessions, one nullable column on work_evidence, a wider run_key on
-- work_finished_item (a session card is keyed "session:<id>"), and the ledger table of the one-time clear of old parked questions.
-- Nothing here closes, deletes or updates a row.

-- AlterTable
ALTER TABLE "oracle_sessions" ADD COLUMN "work_checked_at" TIMESTAMP(3),
ADD COLUMN "close_pass_at" TIMESTAMP(3);

-- AlterTable (a wider varchar: every stored value still fits)
ALTER TABLE "work_finished_item" ALTER COLUMN "run_key" TYPE VARCHAR(80);

-- AlterTable
ALTER TABLE "work_evidence" ADD COLUMN "session_id" VARCHAR(255);

-- CreateTable
CREATE TABLE "work_stale_ask_clear" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "run_key" VARCHAR(60) NOT NULL,
    "session_external_id" VARCHAR(255) NOT NULL,
    "session_title" VARCHAR(500),
    "ask_text" TEXT NOT NULL,
    "ask_hash" VARCHAR(64) NOT NULL,
    "ask_severity" VARCHAR(20),
    "asked_at" TIMESTAMP(3) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'cleared',
    "home_action_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "work_stale_ask_clear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_evidence_session_id_task_id_idx" ON "work_evidence"("session_id", "task_id");

-- CreateIndex
CREATE INDEX "work_stale_ask_clear_user_id_state_idx" ON "work_stale_ask_clear"("user_id", "state");

-- CreateIndex
CREATE INDEX "work_stale_ask_clear_run_key_idx" ON "work_stale_ask_clear"("run_key");

-- CreateIndex
CREATE UNIQUE INDEX "work_stale_ask_clear_run_key_session_external_id_key" ON "work_stale_ask_clear"("run_key", "session_external_id");
