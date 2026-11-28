-- Hold the assignment notice until the task is unblocked (task 5ad27fc9; Mike, 2026-11-27: "I should only get the
-- notification when it's available to me. If it's blocked I should not see it until it's unblocked."). Records who has been
-- told about the current assignment, so a released task notifies its assignee once and never twice. Additive only.
ALTER TABLE "tasks" ADD COLUMN "assignment_noticed_user_id" UUID;

-- Every task assigned before this change already sent its notice at assignment (or was self-assigned): mark it told, so a
-- later release of an old blocked task does not send a second notice.
UPDATE "tasks" SET "assignment_noticed_user_id" = "assignee_id" WHERE "assignee_id" IS NOT NULL;
