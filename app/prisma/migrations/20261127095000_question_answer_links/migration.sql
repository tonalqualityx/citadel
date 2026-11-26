-- Signed one-time answer links for card questions (report pages), and the "held for a chat" mark on a question.
-- Additive only: two nullable columns, one new table, its indexes and foreign key. Safe on existing rows.
ALTER TABLE "task_questions" ADD COLUMN "held_for_chat_at" TIMESTAMP(3),
ADD COLUMN "held_report_url" VARCHAR(500);

CREATE TABLE "question_answer_links" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "option_id" VARCHAR(40),
    "report_url" VARCHAR(500) NOT NULL,
    "wording_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_outcome" VARCHAR(20),
    "minted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_answer_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "question_answer_links_question_id_idx" ON "question_answer_links"("question_id");
CREATE INDEX "question_answer_links_batch_id_idx" ON "question_answer_links"("batch_id");

ALTER TABLE "question_answer_links" ADD CONSTRAINT "question_answer_links_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "task_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
