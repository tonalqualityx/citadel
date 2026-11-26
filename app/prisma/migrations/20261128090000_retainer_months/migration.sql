-- Retainer months (design.md 2.6): one enum and two new tables. Additive only; nothing existing is altered.

-- CreateEnum
CREATE TYPE "RetainerMonthState" AS ENUM ('planning', 'planned', 'closed');

-- CreateTable
CREATE TABLE "retainer_months" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "hours_allotted" DECIMAL(6,2) NOT NULL,
    "state" "RetainerMonthState" NOT NULL DEFAULT 'planning',
    "planning_task_id" UUID,
    "planned_at" TIMESTAMP(3),
    "planned_by_id" UUID,
    "note" VARCHAR(300),
    "used_minutes" INTEGER,
    "outside_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainer_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retainer_month_items" (
    "id" UUID NOT NULL,
    "retainer_month_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "estimate_min_low" INTEGER NOT NULL,
    "estimate_min_high" INTEGER NOT NULL,
    "recurring_work_id" UUID,
    "task_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retainer_month_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retainer_months_charter_id_month_key" ON "retainer_months"("charter_id", "month");

-- CreateIndex
CREATE INDEX "retainer_months_month_idx" ON "retainer_months"("month");

-- CreateIndex
CREATE INDEX "retainer_months_planning_task_id_idx" ON "retainer_months"("planning_task_id");

-- CreateIndex
CREATE INDEX "retainer_month_items_retainer_month_id_idx" ON "retainer_month_items"("retainer_month_id");

-- CreateIndex
CREATE INDEX "retainer_month_items_task_id_idx" ON "retainer_month_items"("task_id");

-- CreateIndex
CREATE INDEX "retainer_month_items_recurring_work_id_idx" ON "retainer_month_items"("recurring_work_id");

-- AddForeignKey
ALTER TABLE "retainer_months" ADD CONSTRAINT "retainer_months_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_months" ADD CONSTRAINT "retainer_months_planning_task_id_fkey" FOREIGN KEY ("planning_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_months" ADD CONSTRAINT "retainer_months_planned_by_id_fkey" FOREIGN KEY ("planned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_month_items" ADD CONSTRAINT "retainer_month_items_retainer_month_id_fkey" FOREIGN KEY ("retainer_month_id") REFERENCES "retainer_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_month_items" ADD CONSTRAINT "retainer_month_items_recurring_work_id_fkey" FOREIGN KEY ("recurring_work_id") REFERENCES "charter_scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_month_items" ADD CONSTRAINT "retainer_month_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
