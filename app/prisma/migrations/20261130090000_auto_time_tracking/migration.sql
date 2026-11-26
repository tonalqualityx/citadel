-- Automatic time tracking becomes a per-person setting (Mike, 2026-11-26: "make auto time tracking a user setting
-- and toggle it off for everyone except me"). Off for everyone by default, including people added later.
ALTER TABLE "user_preferences" ADD COLUMN "auto_time_tracking" BOOLEAN NOT NULL DEFAULT false;

-- On for Mike alone: the active admin whose email is the agency owner's (same match as the bast_chat_owner_seed
-- migration). Creates his preferences row when he has none. Local and test databases without him get nothing.
INSERT INTO "user_preferences" ("id", "user_id", "auto_time_tracking", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id", true, now(), now()
FROM "users" u
WHERE u."email" = 'mike@becomeindelible.com'
  AND u."role" = 'admin'
  AND u."is_active" = true
ORDER BY u."created_at" ASC
LIMIT 1
ON CONFLICT ("user_id") DO UPDATE SET "auto_time_tracking" = true, "updated_at" = now();
