-- Mike, 2026-11-23 ("Yes, build that feature"): a question can sit on the project itself, with no card, because sometimes the answer decides
-- which cards get made. task_id becomes nullable, project_id is new, and exactly one of the two is set. Every existing row keeps its task_id,
-- so nothing is rewritten and the check holds for all of them.
ALTER TABLE "task_questions" ALTER COLUMN "task_id" DROP NOT NULL;
ALTER TABLE "task_questions" ADD COLUMN "project_id" UUID;
ALTER TABLE "task_questions" ADD CONSTRAINT "task_questions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_questions" ADD CONSTRAINT "task_questions_one_home" CHECK (("task_id" IS NULL) <> ("project_id" IS NULL));
CREATE INDEX "task_questions_project_id_state_idx" ON "task_questions"("project_id", "state");
