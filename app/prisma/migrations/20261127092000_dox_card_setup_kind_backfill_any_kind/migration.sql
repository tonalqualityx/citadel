-- Task 8c95ed15, second try: 20261127091000 matched only a card with no kind, but the daily news posts card kept an older kind, so it changed
-- nothing. This sets the card to project_setup whatever its old kind. Compare-and-set, idempotent: only while it is not already project_setup,
-- is still on that project, and the project has no other setup card. A fresh database has no such row: a no-op.
UPDATE "tasks" SET "triage_kind" = 'project_setup', "updated_at" = NOW()
WHERE "id" = '0c7ca690-53c0-4837-9d1d-ce0ee0832ed7'
  AND "project_id" = 'd2f0a487-6ab4-47af-ab77-140a3ab0703a'
  AND "triage_kind" IS DISTINCT FROM 'project_setup'
  AND "is_deleted" = false
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" t2
    WHERE t2."project_id" = 'd2f0a487-6ab4-47af-ab77-140a3ab0703a' AND t2."triage_kind" = 'project_setup' AND t2."is_deleted" = false
      AND t2."id" <> '0c7ca690-53c0-4837-9d1d-ce0ee0832ed7'
  );
