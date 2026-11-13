
-- CreateEnum
CREATE TYPE "TaskQuestionState" AS ENUM ('open', 'answered', 'defaulted', 'withdrawn');

-- CreateEnum
CREATE TYPE "TaskQuestionAction" AS ENUM ('go_with_recommendation', 'wait');

-- CreateTable
CREATE TABLE "task_questions" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "question" VARCHAR(200) NOT NULL,
    "what_it_is" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "checked" TEXT NOT NULL,
    "unknown" TEXT NOT NULL,
    "options" JSONB,
    "recommended_option_id" VARCHAR(40),
    "recommend_why" TEXT,
    "if_nobody" TEXT NOT NULL,
    "if_nobody_action" "TaskQuestionAction" NOT NULL,
    "state" "TaskQuestionState" NOT NULL DEFAULT 'open',
    "asked_by_user_id" UUID,
    "asked_by_lane" VARCHAR(40),
    "chat_conversation_id" UUID,
    "answer_option_id" VARCHAR(40),
    "answer_text" TEXT,
    "answered_at" TIMESTAMP(3),
    "answered_by_id" UUID,
    "answer_comment_id" UUID,
    "defaulted_at" TIMESTAMP(3),
    "withdrawn_reason" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_questions_task_id_state_idx" ON "task_questions"("task_id", "state");

-- AddForeignKey
ALTER TABLE "task_questions" ADD CONSTRAINT "task_questions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

