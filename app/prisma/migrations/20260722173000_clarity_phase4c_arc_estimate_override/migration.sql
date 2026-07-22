-- Clarity Phase 4c — the arc board header's time-estimate override. Additive-only: a
-- single nullable column, no data migration needed (existing rows default to NULL, i.e.
-- "no override, use the computed sum of open tasks' estimated_minutes"). IF NOT EXISTS
-- guard per the standing multi-path-DDL rule, even though this is a single simple ADD
-- COLUMN.
ALTER TABLE "arcs" ADD COLUMN IF NOT EXISTS "estimate_override_minutes" INTEGER;
