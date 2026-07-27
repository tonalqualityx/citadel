-- CreateTable
CREATE TABLE "cron_chip_states" (
    "id" UUID NOT NULL,
    "cron_key" VARCHAR(300) NOT NULL,
    "snoozed_until" TIMESTAMP(3),
    "dismissed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_chip_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cron_chip_states_cron_key_key" ON "cron_chip_states"("cron_key");
