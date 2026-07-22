-- Clarity Phase 4b — Today board lens's Doing column, persisted. Additive-only: a single
-- nullable column, no data migration needed (existing rows default to NULL, i.e. "not
-- started", which is correct for every pre-existing pick).
ALTER TABLE "today_picks" ADD COLUMN "started_at" TIMESTAMP(3);
