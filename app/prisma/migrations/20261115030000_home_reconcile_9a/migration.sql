-- Home Slice 9a: the sent-mail reconciler (notes on his own tasks, one-tap cards, Track it). Three new tables and one defaulted column.
-- No ALTER TYPE. No other table changes.

-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN     "reconcile_on" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "home_reconcile_message" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message_key" VARCHAR(300) NOT NULL,
    "account" VARCHAR(255) NOT NULL,
    "gmail_id" VARCHAR(64) NOT NULL,
    "thread_id" VARCHAR(255) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "to_label" VARCHAR(300),
    "subject" VARCHAR(500),
    "outcome" VARCHAR(20) NOT NULL,
    "refusal" VARCHAR(200),
    "lookback" BOOLEAN NOT NULL DEFAULT false,
    "filter_model" VARCHAR(20),
    "match_model" VARCHAR(20),
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "wrong_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_reconcile_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_reconcile_change" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "state" VARCHAR(12) NOT NULL DEFAULT 'open',
    "target_key" VARCHAR(300),
    "dedupe_key" VARCHAR(300) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "lines" JSONB,
    "plan" JSONB,
    "quote" VARCHAR(400),
    "quote_to" VARCHAR(300),
    "quote_at" TIMESTAMP(3),
    "link" VARCHAR(1000),
    "confidence" VARCHAR(8) NOT NULL,
    "basis" VARCHAR(20)[] DEFAULT ARRAY[]::VARCHAR(20)[],
    "reason" VARCHAR(200),
    "minutes_estimate" INTEGER,
    "estimate_basis" VARCHAR(300),
    "home_action_id" UUID,
    "comment_id" UUID,
    "time_entry_id" UUID,
    "created_ids" JSONB,
    "shown_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "home_reconcile_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_reconcile_hold" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_key" VARCHAR(300) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_reconcile_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "home_reconcile_message_user_id_sent_at_idx" ON "home_reconcile_message"("user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "home_reconcile_message_user_id_message_key_key" ON "home_reconcile_message"("user_id", "message_key");

-- CreateIndex
CREATE INDEX "home_reconcile_change_user_id_state_idx" ON "home_reconcile_change"("user_id", "state");

-- CreateIndex
CREATE INDEX "home_reconcile_change_user_id_target_key_idx" ON "home_reconcile_change"("user_id", "target_key");

-- CreateIndex
CREATE UNIQUE INDEX "home_reconcile_change_user_id_dedupe_key_key" ON "home_reconcile_change"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "home_reconcile_hold_user_id_target_key_key" ON "home_reconcile_hold"("user_id", "target_key");

-- AddForeignKey
ALTER TABLE "home_reconcile_message" ADD CONSTRAINT "home_reconcile_message_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_reconcile_change" ADD CONSTRAINT "home_reconcile_change_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_reconcile_change" ADD CONSTRAINT "home_reconcile_change_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "home_reconcile_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_reconcile_hold" ADD CONSTRAINT "home_reconcile_hold_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

