-- Dox card setup kind, general backfill. Before commit 1ab49bb2, POST /api/projects with the x-dox-card header made the project but did not
-- mark the released card as the project's setup card (tasks.triage_kind = 'project_setup'), so the plan endpoint found no plan for six projects.
-- The two earlier backfills (20261127091000, 20261127092000) fixed one card by id. This one fixes every such card by its mark: a card pass
-- (an engagement_passes row with task_id = the card) that started no later than the project was created, on a project Dox made.
-- A project is changed only when exactly one task qualifies, so an ambiguous project is left alone, and never when it already has a setup card.
-- Compare-and-set and idempotent: a card already project_setup is skipped, and a second run finds nothing. A fresh database has no such row: a no-op.
UPDATE "tasks" t SET "triage_kind" = 'project_setup', "updated_at" = NOW()
FROM "projects" p
WHERE p."id" = t."project_id"
  AND p."is_deleted" = false
  AND p."created_by_id" = '1797579d-2c5e-42de-8366-c38be92ee1ae'
  AND t."is_deleted" = false
  AND t."triage_kind" IS DISTINCT FROM 'project_setup'
  AND 'from-triage' = ANY (t."tags")
  AND EXISTS (
    SELECT 1 FROM "engagement_passes" ep
    WHERE ep."task_id" = t."id" AND ep."started_at" <= p."created_at"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" s
    WHERE s."project_id" = p."id" AND s."is_deleted" = false AND s."triage_kind" = 'project_setup'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" o
    WHERE o."project_id" = p."id" AND o."id" <> t."id" AND o."is_deleted" = false
      AND o."triage_kind" IS DISTINCT FROM 'project_setup'
      AND 'from-triage' = ANY (o."tags")
      AND EXISTS (SELECT 1 FROM "engagement_passes" ep2 WHERE ep2."task_id" = o."id" AND ep2."started_at" <= p."created_at")
  );
