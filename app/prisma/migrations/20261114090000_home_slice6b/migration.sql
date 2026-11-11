-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN     "emergency_slack" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "home_emergency_watch" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_key" VARCHAR(300) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "acted_at" TIMESTAMP(3),
    "slack_first_claimed_at" TIMESTAMP(3),
    "slack_first_claims" INTEGER NOT NULL DEFAULT 0,
    "slack_first_at" TIMESTAMP(3),
    "slack_again_claimed_at" TIMESTAMP(3),
    "slack_again_claims" INTEGER NOT NULL DEFAULT 0,
    "slack_again_at" TIMESTAMP(3),
    "lifeline_line_on" DATE,
    "lifeline_claim_on" DATE,
    "lifeline_claimed_at" TIMESTAMP(3),
    "lifeline_claims" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_emergency_watch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_emergency_watch_user_id_item_key_key" ON "home_emergency_watch"("user_id", "item_key");

-- AddForeignKey
ALTER TABLE "home_emergency_watch" ADD CONSTRAINT "home_emergency_watch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

