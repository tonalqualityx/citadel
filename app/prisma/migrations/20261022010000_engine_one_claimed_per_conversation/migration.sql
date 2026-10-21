-- Portal phase C review: at most one claimed job per conversation, as a database fact.
-- Prisma cannot express a partial index in the schema; this index is managed here.
CREATE UNIQUE INDEX "engine_jobs_one_claimed_per_conversation"
  ON "engine_jobs" ("conversation_id")
  WHERE "status" = 'claimed' AND "conversation_id" IS NOT NULL;
