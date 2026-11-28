-- Keep, Cut and Make weekly buttons on each Recurring work row. Additive only: one enum, four nullable columns, two
-- foreign keys and an index. A pick never changes the schedule.
CREATE TYPE "RecurringPick" AS ENUM ('keep', 'cut', 'weekly');

ALTER TABLE "charter_scheduled_tasks"
  ADD COLUMN "mike_pick" "RecurringPick",
  ADD COLUMN "mike_pick_at" TIMESTAMP(3),
  ADD COLUMN "mike_pick_by_id" UUID,
  ADD COLUMN "pick_task_id" UUID;

CREATE INDEX "charter_scheduled_tasks_pick_task_id_idx" ON "charter_scheduled_tasks"("pick_task_id");

ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_mike_pick_by_id_fkey" FOREIGN KEY ("mike_pick_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_pick_task_id_fkey" FOREIGN KEY ("pick_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
