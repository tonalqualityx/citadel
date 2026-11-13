-- A card pass: Dox working one released card that has no project. Additive: the brief becomes optional on a pass, a pass may name a card instead.
ALTER TABLE "engagement_passes" ALTER COLUMN "brief_id" DROP NOT NULL;
ALTER TABLE "engagement_passes" ADD COLUMN "task_id" UUID;
CREATE INDEX "engagement_passes_task_id_started_at_idx" ON "engagement_passes"("task_id", "started_at");
