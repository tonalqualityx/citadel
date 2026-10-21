-- Portal A2 login hardening. Additive and nullable; nothing removed. Reversible by dropping the columns.
-- magic_token_hash: SHA-256 hex of a single-use login link token (raw token never stored).
-- revoked_at: ends a session early (logout, contact deleted, portal role none).
-- Legacy magic_token rows are left in place and are never matched by the new lookup.

-- AlterTable
ALTER TABLE "portal_sessions" ADD COLUMN     "magic_token_hash" VARCHAR(64),
ADD COLUMN     "revoked_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_magic_token_hash_key" ON "portal_sessions"("magic_token_hash");
