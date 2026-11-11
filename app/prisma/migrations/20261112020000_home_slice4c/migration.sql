-- Home screen Slice 4c: owed-reply clocks, re-surfacing, wake on new activity, cross-inbox joining.
-- Nullable or defaulted columns only. No ALTER TYPE.

-- AlterTable
ALTER TABLE "home_item_state" ADD COLUMN     "parked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "home_owed_thread" ADD COLUMN     "lead_clock_from" TIMESTAMP(3),
ADD COLUMN     "resurfaced_at" TIMESTAMP(3),
ADD COLUMN     "resurface_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "not_lead_at" TIMESTAMP(3),
ADD COLUMN     "keep_lead_at" TIMESTAMP(3),
ADD COLUMN     "joined_to_key" VARCHAR(300),
ADD COLUMN     "replied_elsewhere_at" TIMESTAMP(3),
ADD COLUMN     "replied_elsewhere_from" VARCHAR(320),
ADD COLUMN     "auto_drafted_at" TIMESTAMP(3),
ADD COLUMN     "short_draft_id" VARCHAR(64),
ADD COLUMN     "short_draft_hash" VARCHAR(64),
ADD COLUMN     "short_draft_text" TEXT;
