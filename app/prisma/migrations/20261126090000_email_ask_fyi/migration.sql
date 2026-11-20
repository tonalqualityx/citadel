-- FYI mail (Mike, 2026-11-20). disposition is VARCHAR(20), so the new value needs no DDL. One nullable column.
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "addressed_to" VARCHAR(120);
