-- A card may have several conversations over time ("start fresh on this card"); at most one is open.
-- DropIndex
DROP INDEX "bast_chat_conversations_owner_id_task_id_key";

-- CreateIndex
CREATE INDEX "bast_chat_conversations_owner_id_task_id_idx" ON "bast_chat_conversations"("owner_id", "task_id");

-- Written by hand (Prisma cannot express a partial index): one OPEN conversation per owner and card.
-- General chats (task_id NULL) are outside it, as before.
CREATE UNIQUE INDEX "bast_chat_conversations_one_open_per_card" ON "bast_chat_conversations"("owner_id", "task_id") WHERE "task_id" IS NOT NULL AND "status" <> 'closed';
