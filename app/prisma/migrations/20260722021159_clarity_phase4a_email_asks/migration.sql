-- CreateEnum
CREATE TYPE "EmailAskState" AS ENUM ('open', 'handled', 'dismissed');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'oracle_urgent_email';

-- CreateTable
CREATE TABLE "email_asks" (
    "id" UUID NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "thread_id" VARCHAR(255),
    "account" VARCHAR(255) NOT NULL,
    "from_name" VARCHAR(255),
    "from_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "gist" TEXT,
    "queue" "AskQueue",
    "severity" "AskSeverity",
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "state" "EmailAskState" NOT NULL DEFAULT 'open',
    "task_id" UUID,
    "deep_link" VARCHAR(1000) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_asks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_asks_message_id_key" ON "email_asks"("message_id");

-- CreateIndex
CREATE INDEX "email_asks_state_idx" ON "email_asks"("state");

-- CreateIndex
CREATE INDEX "email_asks_is_urgent_idx" ON "email_asks"("is_urgent");

-- CreateIndex
CREATE INDEX "email_asks_received_at_idx" ON "email_asks"("received_at");

-- AddForeignKey
ALTER TABLE "email_asks" ADD CONSTRAINT "email_asks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
