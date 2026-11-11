ALTER TABLE "home_item_state" ADD COLUMN "session_cleared_at" TIMESTAMP(3),
ADD COLUMN "session_cleared_hash" VARCHAR(64);
