-- Home screen: switch Slice 4b ("Send the draft"), and the keeper's arc writes (create, close, link tasks) on for the
-- chat owner (Mike, 2026-11-11: "Yes let's move forward on everything"). Data only: no schema change.
-- The owner is the same user the Bast chat settings row names. Every other column keeps its default.
-- Idempotent: running it again leaves the same four flags true. Does nothing when no owner row exists.
INSERT INTO "home_keeper_settings" ("id", "user_id", "owed_send", "arcs_create", "arcs_close", "arcs_link_tasks", "updated_at")
SELECT gen_random_uuid(), s."owner_user_id", true, true, true, true, now()
FROM "bast_chat_settings" s
WHERE s."id" = 1
  AND s."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "owed_send" = true,
    "arcs_create" = true,
    "arcs_close" = true,
    "arcs_link_tasks" = true,
    "updated_at" = now();
