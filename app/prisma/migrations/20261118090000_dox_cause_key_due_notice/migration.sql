-- AlterTable
ALTER TABLE "task_questions" ADD COLUMN     "cause_key" VARCHAR(120);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "due_notice_for" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "task_questions_cause_key_state_idx" ON "task_questions"("cause_key", "state");
