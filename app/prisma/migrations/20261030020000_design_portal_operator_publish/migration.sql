-- Designer Portal operator keys (Mike, 2026-10-29): record whether a publish or rollback was clicked in a
-- signed-in session or made by an admin's design:operator-publish API key (Bast on Mike's instruction), and which key.
ALTER TABLE "design_publishes" ADD COLUMN "actor_via" VARCHAR(20) NOT NULL DEFAULT 'session';
ALTER TABLE "design_publishes" ADD COLUMN "actor_api_key_id" UUID;
