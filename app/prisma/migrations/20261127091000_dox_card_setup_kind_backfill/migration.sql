-- Task 8c95ed15: a card Dox turned into a project kept its old kind, so its project had no setup card and no plan. The route now sets the kind
-- when it links the card; this sets it for the one card already linked that way (the daily news posts card). Compare-and-set, idempotent: only
-- while the card still has no kind, is still on that project, and the project has no other setup card. A fresh database has no such row: a no-op.
UPDATE "tasks" SET "triage_kind" = 'project_setup', "updated_at" = NOW()
WHERE "id" = '0c7ca690-53c0-4837-9d1d-ce0ee0832ed7'
  AND "project_id" = 'd2f0a487-6ab4-47af-ab77-140a3ab0703a'
  AND "triage_kind" IS NULL
  AND "is_deleted" = false
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" t2
    WHERE t2."project_id" = 'd2f0a487-6ab4-47af-ab77-140a3ab0703a' AND t2."triage_kind" = 'project_setup' AND t2."is_deleted" = false
  );
