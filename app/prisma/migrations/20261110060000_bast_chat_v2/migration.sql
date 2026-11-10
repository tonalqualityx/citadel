-- AlterTable
ALTER TABLE "bast_chat_actions" ADD COLUMN     "plan" JSONB,
ADD COLUMN     "proposal_kind" VARCHAR(30),
ADD COLUMN     "reach" JSONB,
ADD COLUMN     "turn_seq" INTEGER;

-- CreateIndex
CREATE INDEX "bast_chat_actions_target_type_target_id_created_at_idx" ON "bast_chat_actions"("target_type", "target_id", "created_at");

