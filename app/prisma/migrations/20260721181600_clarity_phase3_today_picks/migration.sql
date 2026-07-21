-- CreateEnum
CREATE TYPE "TodayPickType" AS ENUM ('arc', 'task', 'session', 'lead', 'note');

-- CreateTable
CREATE TABLE "today_picks" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "item_type" "TodayPickType" NOT NULL,
    "arc_id" UUID,
    "task_id" UUID,
    "session_external_id" VARCHAR(255),
    "charter_id" UUID,
    "label" VARCHAR(300),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "today_picks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "today_picks_date_idx" ON "today_picks"("date");

-- CreateIndex
CREATE INDEX "today_picks_arc_id_idx" ON "today_picks"("arc_id");

-- CreateIndex
CREATE INDEX "today_picks_task_id_idx" ON "today_picks"("task_id");

-- CreateIndex
CREATE INDEX "today_picks_charter_id_idx" ON "today_picks"("charter_id");

-- AddForeignKey
ALTER TABLE "today_picks" ADD CONSTRAINT "today_picks_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_picks" ADD CONSTRAINT "today_picks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_picks" ADD CONSTRAINT "today_picks_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
