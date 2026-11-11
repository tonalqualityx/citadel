-- Home screen: switch Slice 9a (the sent-mail reconciler: notes on his own tasks and cards from his sent mail) on for the chat owner.
-- Data only: no schema change. The owner is the user the Bast chat settings row names. Only reconcile_on is set; every other column keeps its value.
-- Idempotent: running it again leaves the same flag true. Does nothing when no owner row exists.
INSERT INTO "home_keeper_settings" ("id", "user_id", "reconcile_on", "updated_at")
SELECT gen_random_uuid(), s."owner_user_id", true, now()
FROM "bast_chat_settings" s
WHERE s."id" = 1
  AND s."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "reconcile_on" = true,
    "updated_at" = now();
