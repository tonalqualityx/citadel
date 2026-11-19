-- Client questions (Mike, 2026-11-19): a card question can be one we sent a client contact by email, and it blocks cards exactly as a
-- task dependency does. Additive only: new nullable columns, one join table, indexes. Nothing is dropped or rewritten.
-- AlterTable
ALTER TABLE "task_questions" ADD COLUMN     "asked_of_contact_id" UUID,
ADD COLUMN     "default_at" TIMESTAMP(3),
ADD COLUMN     "nudge_drafted_at" TIMESTAMP(3),
ADD COLUMN     "sent_account" VARCHAR(120),
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "sent_message_id" VARCHAR(200),
ADD COLUMN     "sent_thread_id" VARCHAR(200);

-- CreateTable
CREATE TABLE "_QuestionBlocks" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_QuestionBlocks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_QuestionBlocks_B_index" ON "_QuestionBlocks"("B");

-- CreateIndex
CREATE INDEX "task_questions_state_default_at_idx" ON "task_questions"("state", "default_at");

-- CreateIndex
CREATE INDEX "task_questions_asked_of_contact_id_idx" ON "task_questions"("asked_of_contact_id");

-- AddForeignKey
ALTER TABLE "task_questions" ADD CONSTRAINT "task_questions_asked_of_contact_id_fkey" FOREIGN KEY ("asked_of_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuestionBlocks" ADD CONSTRAINT "_QuestionBlocks_A_fkey" FOREIGN KEY ("A") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuestionBlocks" ADD CONSTRAINT "_QuestionBlocks_B_fkey" FOREIGN KEY ("B") REFERENCES "task_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

