-- The Recurring work tab keeps the groups a person collapsed, per user and across devices (task 3c5d8085). Additive only.
ALTER TABLE "user_preferences" ADD COLUMN "recurring_collapsed_groups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
