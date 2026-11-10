-- Bast chat: raise every limit far out of reach (Mike, 2026-11-10: "I think we need to drop the limits ...
-- Or set them absurdly high."). The mechanisms stay only as a guard against a runaway loop.
-- Data only: no schema change. Does nothing when the settings row does not exist.
UPDATE "bast_chat_settings"
SET "daily_write_cap" = 1000000,
    "daily_turn_cap" = 1000000,
    "daily_cost_cap_usd" = 1000000,
    "turn_budget_usd" = 1000,
    "updated_at" = now()
WHERE "id" = 1;
