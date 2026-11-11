-- Home screen Slice 4b: "Send the draft" through the mail outbox with a 10-minute hold, shipped switched OFF.
-- Nullable or defaulted columns only. No ALTER TYPE. No row is inserted: a missing home_keeper_settings row means off.

-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "send_after" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN     "owed_send" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "email_outbox_kind_send_after_idx" ON "email_outbox"("kind", "send_after");
