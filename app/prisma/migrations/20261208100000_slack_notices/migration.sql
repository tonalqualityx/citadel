-- Every Slack direct message decision: keep (posted at once), digest (a line in the daily DM), stop (log only).
-- CreateTable
CREATE TABLE "slack_notices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sort" VARCHAR(10) NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "entity_type" VARCHAR(50),
    "entity_id" TEXT,
    "link" TEXT,
    "posted_text" TEXT,
    "slack_channel" VARCHAR(50),
    "slack_ts" VARCHAR(50),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_notices_user_id_sort_sent_at_idx" ON "slack_notices"("user_id", "sort", "sent_at");

-- CreateIndex
CREATE INDEX "slack_notices_created_at_idx" ON "slack_notices"("created_at");

-- AddForeignKey
ALTER TABLE "slack_notices" ADD CONSTRAINT "slack_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
