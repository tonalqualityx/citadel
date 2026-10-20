-- Local plan folder pointer for a project (e.g. /home/mike/Documents/projects/<slug>).
-- Additive nullable column, no backfill — reversible by dropping the column.
-- AlterTable
ALTER TABLE "projects" ADD COLUMN "plan_folder" TEXT;
