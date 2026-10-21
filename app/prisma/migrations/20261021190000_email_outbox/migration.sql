-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "to" VARCHAR(320) NOT NULL,
    "cc" VARCHAR(1000),
    "subject" VARCHAR(500) NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "from_account" VARCHAR(320) NOT NULL DEFAULT 'bast@becomeindelible.com',
    "kind" VARCHAR(30) NOT NULL DEFAULT 'other',
    "allow_external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "message_id" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "dedupe_key" VARCHAR(128),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "email_outbox_sent_at_created_at_idx" ON "email_outbox"("sent_at", "created_at");
