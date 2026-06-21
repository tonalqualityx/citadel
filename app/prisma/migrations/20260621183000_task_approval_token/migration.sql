-- Per-task client approval portal token (mirrors Proposal/Contract pattern).
-- Additive, nullable columns — reversible, no data loss.
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "portal_token" VARCHAR(128),
ADD COLUMN     "portal_token_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_portal_token_idx" ON "tasks"("portal_token");
