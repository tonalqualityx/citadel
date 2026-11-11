-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN     "outside_scan" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "home_emergency_watch" ADD COLUMN     "scan_site_id" UUID,
ADD COLUMN     "scan_requested_at" TIMESTAMP(3),
ADD COLUMN     "scan_at" TIMESTAMP(3),
ADD COLUMN     "scan_summary" VARCHAR(500),
ADD COLUMN     "scan_json" JSONB;

-- CreateIndex
CREATE INDEX "home_emergency_watch_user_id_scan_site_id_scan_requested_at_idx" ON "home_emergency_watch"("user_id", "scan_site_id", "scan_requested_at");
