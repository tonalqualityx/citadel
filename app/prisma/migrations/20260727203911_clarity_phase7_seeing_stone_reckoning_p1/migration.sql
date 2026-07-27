-- AlterTable
ALTER TABLE "arcs" ADD COLUMN     "accord_id" UUID,
ADD COLUMN     "cover_url" VARCHAR(1000),
ADD COLUMN     "next_touch" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "email_asks" ADD COLUMN     "arc_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "cover_url" VARCHAR(1000);

-- AlterTable
ALTER TABLE "today_picks" ADD COLUMN     "accord_id" UUID,
ADD COLUMN     "calendar_event_id" VARCHAR(255);

-- CreateIndex
CREATE INDEX "arcs_accord_id_idx" ON "arcs"("accord_id");

-- CreateIndex
CREATE INDEX "email_asks_arc_id_idx" ON "email_asks"("arc_id");

-- CreateIndex
CREATE INDEX "today_picks_accord_id_idx" ON "today_picks"("accord_id");

-- CreateIndex
CREATE INDEX "today_picks_calendar_event_id_idx" ON "today_picks"("calendar_event_id");

-- AddForeignKey
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_picks" ADD CONSTRAINT "today_picks_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_asks" ADD CONSTRAINT "email_asks_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
