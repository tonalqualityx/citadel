-- AlterTable
ALTER TABLE "bast_chat_conversations" ADD COLUMN     "task_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "bast_chat_conversations_owner_id_task_id_key" ON "bast_chat_conversations"("owner_id", "task_id");

