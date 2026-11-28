-- Recurring work records its Claude usage, where its output goes, when a person last used it, and a priority
-- (task b2d301d7). Additive only: one new enum and thirteen new columns, nothing dropped or rewritten.
CREATE TYPE "RecurringPriority" AS ENUM ('normal', 'low');

ALTER TABLE "charter_scheduled_tasks"
  ADD COLUMN "usage_week_tokens" BIGINT,
  ADD COLUMN "usage_month_tokens" BIGINT,
  ADD COLUMN "usage_week_usd" DECIMAL(10,2),
  ADD COLUMN "usage_month_usd" DECIMAL(10,2),
  ADD COLUMN "usage_week_share" DECIMAL(6,2),
  ADD COLUMN "usage_state" VARCHAR(20),
  ADD COLUMN "usage_note" VARCHAR(200),
  ADD COLUMN "usage_updated_at" TIMESTAMP(3),
  ADD COLUMN "destinations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "destination_note" VARCHAR(300),
  ADD COLUMN "last_used_at" TIMESTAMP(3),
  ADD COLUMN "last_used_signal" VARCHAR(200),
  ADD COLUMN "priority" "RecurringPriority" NOT NULL DEFAULT 'normal';
