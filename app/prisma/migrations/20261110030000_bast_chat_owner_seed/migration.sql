-- Bast chat: seed the single settings row so the owner can switch the chat on.
-- The owner is the one active admin user whose email is the agency owner's (the same address the
-- email-sync and create-task routes use as the default assignee). The chat stays DISABLED.
-- When no such user exists (local and test databases) nothing is inserted.
-- Data only: no schema change.
INSERT INTO "bast_chat_settings" ("id", "enabled", "owner_user_id", "updated_at")
SELECT 1, false, u."id", now()
FROM "users" u
WHERE u."email" = 'mike@becomeindelible.com'
  AND u."role" = 'admin'
  AND u."is_active" = true
ORDER BY u."created_at" ASC
LIMIT 1
ON CONFLICT ("id") DO NOTHING;
