-- Designer Portal (Mike, 2026-10-29): every recorded change says whether it touched one instance or the library
-- component everywhere it renders. Nullable: rows from before this, and restores, have none.
ALTER TABLE "design_changes" ADD COLUMN "edit_scope" VARCHAR(20);
