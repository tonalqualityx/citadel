-- Dox client reports: a report cadence on the engagement brief. Additive only.
ALTER TABLE "engagement_briefs" ADD COLUMN "report_cadence" VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE "engagement_briefs" ADD COLUMN "report_day" VARCHAR(3);
ALTER TABLE "engagement_briefs" ADD COLUMN "report_to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "engagement_briefs" ADD COLUMN "report_source" JSONB;
ALTER TABLE "engagement_briefs" ADD COLUMN "last_report_at" TIMESTAMP(3);
