-- Fleet item 5: receipts and approval bound to the preview. Additive only.
-- CreateEnum
CREATE TYPE "task_receipt_step" AS ENUM ('staged', 'approved', 'approval_voided', 'live', 'send', 'send_dropped');

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "approval_binding_mode" TEXT NOT NULL DEFAULT 'warn';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approved_commit_sha" VARCHAR(64),
ADD COLUMN     "approved_deploy_id" VARCHAR(128),
ADD COLUMN     "approved_preview_url" VARCHAR(500),
ADD COLUMN     "staging_commit_sha" VARCHAR(64),
ADD COLUMN     "staging_deploy_id" VARCHAR(128),
ADD COLUMN     "staging_deploy_url" VARCHAR(500);

-- CreateTable
CREATE TABLE "task_receipts" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step" "task_receipt_step" NOT NULL,
    "commit_sha" VARCHAR(64),
    "deploy_id" VARCHAR(128),
    "deploy_url" VARCHAR(500),
    "preview_url" VARCHAR(500),
    "live_url" VARCHAR(500),
    "live_check" JSONB,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outbox_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approval_source" VARCHAR(300),
    "mismatch" BOOLEAN NOT NULL DEFAULT false,
    "actor_user_id" UUID,
    "claim_holder" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_receipts_task_id_created_at_idx" ON "task_receipts"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "task_receipts" ADD CONSTRAINT "task_receipts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

