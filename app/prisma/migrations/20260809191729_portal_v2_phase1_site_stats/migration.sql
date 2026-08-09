-- CreateTable
CREATE TABLE "site_stats_snapshots" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "period" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_stats_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_stats_snapshots_site_id_captured_at_idx" ON "site_stats_snapshots"("site_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_stats_snapshots_site_id_period_captured_at_key" ON "site_stats_snapshots"("site_id", "period", "captured_at");

-- AddForeignKey
ALTER TABLE "site_stats_snapshots" ADD CONSTRAINT "site_stats_snapshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
