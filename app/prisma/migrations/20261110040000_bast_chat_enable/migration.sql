-- Bast chat: switch the chat on for its owner and raise the daily limits (Mike, 2026-11-10: "Yes", and
-- "we also don't want to neuter it"). The limits stay as a guard against a runaway, not as a ration.
-- Data only: no schema change. Does nothing when the settings row or its owner is missing.
UPDATE "bast_chat_settings"
SET "enabled" = true,
    "daily_write_cap" = 200,
    "daily_turn_cap" = 300,
    "updated_at" = now()
WHERE "id" = 1
  AND "owner_user_id" IS NOT NULL;
