-- Secret drop (task 0f36c806): one-time links Mike pastes a key into. Holds only ciphertext, and only until the Bast machine stores the key.
-- Additive only.
CREATE TABLE "secret_drops" (
    "id" UUID NOT NULL,
    "key_name" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "task_id" UUID,
    "mike_task_id" UUID,
    "public_key" JSONB NOT NULL,
    "replaces_existing" BOOLEAN NOT NULL DEFAULT false,
    "added_needs_mike" BOOLEAN NOT NULL DEFAULT false,
    "ciphertext" TEXT,
    "submitted_at" TIMESTAMP(3),
    "stored_at" TIMESTAMP(3),
    "stored_where" VARCHAR(200),
    "failed_at" TIMESTAMP(3),
    "failed_reason" VARCHAR(300),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "minted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_drops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "secret_drops_task_id_idx" ON "secret_drops"("task_id");
