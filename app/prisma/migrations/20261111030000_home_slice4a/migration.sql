
-- CreateTable
CREATE TABLE "home_owed_thread" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "thread_key" VARCHAR(300) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "request_kind" VARCHAR(20),
    "requested_at" TIMESTAMP(3),
    "draft_id" VARCHAR(64),
    "draft_message_id" VARCHAR(64),
    "draft_hash" VARCHAR(64),
    "draft_text" TEXT,
    "draft_for_ask_id" UUID,
    "drafted_at" TIMESTAMP(3),
    "mike_edited_at" TIMESTAMP(3),
    "bast_read" VARCHAR(400),
    "suggested_answer" VARCHAR(300),
    "needs_commitment" BOOLEAN NOT NULL DEFAULT false,
    "thought_since" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "last_model" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_owed_thread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_owed_thread_user_id_thread_key_key" ON "home_owed_thread"("user_id", "thread_key");

-- AddForeignKey
ALTER TABLE "home_owed_thread" ADD CONSTRAINT "home_owed_thread_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

