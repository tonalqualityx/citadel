-- Home screen: switch Slice 6b (Slack lines to Mike for emergencies) on for the chat owner (Mike, 2026-11-11: "Yes let's
-- move forward on everything"). Data only: no schema change.
-- The owner is the same user the Bast chat settings row names. Only emergency_slack is set; every other column keeps its value.
-- Idempotent: running it again leaves the same flag true. Does nothing when no owner row exists.
INSERT INTO "home_keeper_settings" ("id", "user_id", "emergency_slack", "updated_at")
SELECT gen_random_uuid(), s."owner_user_id", true, now()
FROM "bast_chat_settings" s
WHERE s."id" = 1
  AND s."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "emergency_slack" = true,
    "updated_at" = now();
