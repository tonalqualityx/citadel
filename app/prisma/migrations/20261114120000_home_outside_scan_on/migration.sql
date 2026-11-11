-- Home screen: switch Slice 6c (the automatic read-only outside scan of a client site that went down or carries a security flag)
-- on for the chat owner (the owner approved Slice 6c on 2026-11-11). Data only: no schema change.
-- The owner is the same user the Bast chat settings row names. Only outside_scan is set; every other column keeps its value.
-- Idempotent: running it again leaves the same flag true. Does nothing when no owner row exists.
INSERT INTO "home_keeper_settings" ("id", "user_id", "outside_scan", "updated_at")
SELECT gen_random_uuid(), s."owner_user_id", true, now()
FROM "bast_chat_settings" s
WHERE s."id" = 1
  AND s."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "outside_scan" = true,
    "updated_at" = now();
