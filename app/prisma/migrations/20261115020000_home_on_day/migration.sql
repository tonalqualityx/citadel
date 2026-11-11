-- Home screen: "Do it on a day" and "Snooze". Nullable or defaulted columns only.

-- AlterTable
ALTER TABLE "home_item_state" ADD COLUMN "on_day" DATE,
ADD COLUMN "snoozed_until" TIMESTAMP(3),
ADD COLUMN "snooze_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "snooze_day" DATE;
