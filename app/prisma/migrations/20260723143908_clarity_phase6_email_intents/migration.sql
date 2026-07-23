-- Clarity Phase 6 — email lanes & calendar intents. Additive-only.
--
-- CreateEnum, guarded — Postgres has no native `CREATE TYPE ... IF NOT EXISTS` (unlike
-- CREATE TABLE/ADD COLUMN), so the standing "IF NOT EXISTS on the enum" rule is expressed
-- via a DO block that swallows the duplicate_object error if the type already exists.
DO $$ BEGIN
    CREATE TYPE "EmailAskIntent" AS ENUM ('general', 'meeting', 'sales');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable — every column nullable (or boolean-defaulted false, same discipline as
-- is_urgent/calendar_requested elsewhere on this model) so every pre-existing email_asks
-- row is valid with no backfill: intent null renders as "general" per EmailAskIntent's own
-- doc comment; the proposed_event_* trio null means no parsed meeting time and no
-- Add-to-calendar button at all (never guessed at).
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "intent" "EmailAskIntent";
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "proposed_event_at" TIMESTAMP(3);
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "proposed_event_title" VARCHAR(500);
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "proposed_event_minutes" INTEGER;
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "calendar_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "calendar_event_id" VARCHAR(255);
