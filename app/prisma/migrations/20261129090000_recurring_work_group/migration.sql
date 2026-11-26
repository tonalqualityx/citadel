-- A recurring work row can name the group it shows under (machine rows get it from the import config)
ALTER TABLE "charter_scheduled_tasks" ADD COLUMN "group_label" VARCHAR(60);
