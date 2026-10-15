-- Draft-started marker. Additive-only, nullable, no backfill.
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "draft_started_at" TIMESTAMP(3);
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "draft_url" VARCHAR(1000);
