-- Milestone quarter priority ("rock"): rock_quarter like "2027-Q1" (null = not a rock) and the yes-or-no line that says it is done.
-- Additive only: two nullable columns and an index. Safe on existing rows.
ALTER TABLE "milestones" ADD COLUMN "rock_quarter" VARCHAR(7),
ADD COLUMN "rock_done_when" VARCHAR(300);

CREATE INDEX "milestones_rock_quarter_idx" ON "milestones"("rock_quarter");
