-- Recurring work (design.md 2.5): the charter scheduled task, widened in place. Same table, no copy.
-- Additive and reversible only: one enum, three NOT NULL drops, new nullable or defaulted columns, indexes and foreign keys.
-- The new unique index on the generation log is created before the old three-column one is dropped.

-- CreateEnum
CREATE TYPE "RecurringKind" AS ENUM ('citadel_task', 'machine_job', 'engine');

-- AlterTable: a non-charter row has no charter, and a machine or engine row has no SOP or cadence
ALTER TABLE "charter_scheduled_tasks" ALTER COLUMN "charter_id" DROP NOT NULL,
ALTER COLUMN "sop_id" DROP NOT NULL,
ALTER COLUMN "cadence" DROP NOT NULL;

-- AlterTable
ALTER TABLE "charter_scheduled_tasks" ADD COLUMN     "kind" "RecurringKind" NOT NULL DEFAULT 'citadel_task',
ADD COLUMN     "title" VARCHAR(200),
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "produces" VARCHAR(300),
ADD COLUMN     "client_id" UUID,
ADD COLUMN     "site_id" UUID,
ADD COLUMN     "initiative_id" UUID,
ADD COLUMN     "schedule_text" VARCHAR(120),
ADD COLUMN     "cron_expr" VARCHAR(60),
ADD COLUMN     "job_key" VARCHAR(120),
ADD COLUMN     "source_kind" VARCHAR(30),
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "is_plumbing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_run_at" TIMESTAMP(3),
ADD COLUMN     "last_run_ok" BOOLEAN,
ADD COLUMN     "last_run_note" VARCHAR(300),
ADD COLUMN     "next_run_at" TIMESTAMP(3),
ADD COLUMN     "paused_on_purpose" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: the generation log may belong to a non-charter row
ALTER TABLE "charter_generation_logs" ALTER COLUMN "charter_id" DROP NOT NULL;

-- AlterTable: the task a recurring row generated
ALTER TABLE "tasks" ADD COLUMN     "recurring_work_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "charter_scheduled_tasks_job_key_key" ON "charter_scheduled_tasks"("job_key");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_owner_id_idx" ON "charter_scheduled_tasks"("owner_id");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_client_id_idx" ON "charter_scheduled_tasks"("client_id");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_initiative_id_idx" ON "charter_scheduled_tasks"("initiative_id");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_kind_idx" ON "charter_scheduled_tasks"("kind");

-- CreateIndex: new unique key first (Postgres treats nulls as distinct, so the old key would let a non-charter row generate twice)
CREATE UNIQUE INDEX "charter_generation_logs_scheduled_task_id_period_key" ON "charter_generation_logs"("scheduled_task_id", "period");

-- DropIndex: only after the new one exists
DROP INDEX "charter_generation_logs_charter_id_scheduled_task_id_period_key";

-- CreateIndex
CREATE INDEX "tasks_recurring_work_id_idx" ON "tasks"("recurring_work_id");

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_work_id_fkey" FOREIGN KEY ("recurring_work_id") REFERENCES "charter_scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
