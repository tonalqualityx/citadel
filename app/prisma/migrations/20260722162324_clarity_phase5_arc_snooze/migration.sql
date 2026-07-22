-- Clarity Phase 5 — the Soothsayer's snooze action. Additive-only: a single nullable
-- column, no data migration needed (existing rows default to NULL, i.e. "not snoozed",
-- which is correct for every pre-existing arc). IF NOT EXISTS guard per the standing
-- multi-path-DDL rule, even though this is a single simple ADD COLUMN.
ALTER TABLE "arcs" ADD COLUMN IF NOT EXISTS "snoozed_until" TIMESTAMP(3);
