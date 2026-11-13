-- CreateEnum
CREATE TYPE "PlanSection" AS ENUM ('requirements', 'dates', 'team', 'billing', 'examples', 'decisions');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "triage_rev" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "task_plan_items" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "section" "PlanSection" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "wrong_at" TIMESTAMP(3),
    "wrong_by" VARCHAR(60),
    "updated_by_user_id" UUID,
    "updated_by" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_changes" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "rev" INTEGER NOT NULL,
    "area" VARCHAR(40) NOT NULL,
    "line" VARCHAR(240) NOT NULL,
    "note" VARCHAR(240),
    "by" VARCHAR(60) NOT NULL,
    "by_user_id" UUID,
    "by_lane" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_plan_items_task_id_section_position_idx" ON "task_plan_items"("task_id", "section", "position");

-- CreateIndex
CREATE INDEX "triage_changes_task_id_created_at_idx" ON "triage_changes"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "task_plan_items" ADD CONSTRAINT "task_plan_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_changes" ADD CONSTRAINT "triage_changes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
