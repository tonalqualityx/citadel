-- Dox slice 2b, additive only: what a pass is for (setup, sweep or report) and the plan requirements a task serves.
-- Both columns can stay after a revert of the code: nothing else reads them.
ALTER TABLE "engagement_passes" ADD COLUMN     "kind" VARCHAR(10);
ALTER TABLE "tasks" ADD COLUMN     "plan_item_ids" UUID[] DEFAULT ARRAY[]::UUID[];
