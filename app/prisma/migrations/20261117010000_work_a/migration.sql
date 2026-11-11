-- Work stage A (link and close): the closing record on email asks. Nullable columns and indexes only, no ALTER TYPE.
ALTER TABLE "email_asks" ADD COLUMN "rfc_message_id" VARCHAR(255),
ADD COLUMN "conversation_key" VARCHAR(255),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "closed_reason" VARCHAR(40),
ADD COLUMN "closed_by" VARCHAR(20);

-- CreateIndex
CREATE INDEX "email_asks_rfc_message_id_idx" ON "email_asks"("rfc_message_id");

-- CreateIndex
CREATE INDEX "email_asks_conversation_key_idx" ON "email_asks"("conversation_key");

-- CreateIndex
CREATE INDEX "email_asks_task_id_idx" ON "email_asks"("task_id");
