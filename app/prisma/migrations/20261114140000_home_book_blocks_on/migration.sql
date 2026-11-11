-- Home screen: switch Slice 4d ("Book 30 minutes", a private block on the owner's own calendar from a needs-thought row)
-- on for the chat owner (the owner approved Slice 4d on 2026-11-11). Data only: no schema change.
-- The owner is the same user the Bast chat settings row names. Only book_blocks is set; every other column keeps its value.
-- Idempotent: running it again leaves the same flag true. Does nothing when no owner row exists.
INSERT INTO "home_keeper_settings" ("id", "user_id", "book_blocks", "updated_at")
SELECT gen_random_uuid(), s."owner_user_id", true, now()
FROM "bast_chat_settings" s
WHERE s."id" = 1
  AND s."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "book_blocks" = true,
    "updated_at" = now();
