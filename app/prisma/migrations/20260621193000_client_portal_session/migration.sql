-- Client portal login sessions on the existing portal_sessions table (C1).
-- Reuses PortalSession: token_type='client_session', entity_id=client_id, tied to a contact.
-- All columns are additive + nullable so existing audit-log rows are untouched, and the unique
-- token constraints are safe because no client_session rows exist yet. Reversible (drop columns).

-- AlterTable
ALTER TABLE "portal_sessions" ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "magic_token" VARCHAR(128),
ADD COLUMN     "magic_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "session_token" VARCHAR(128),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "consumed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_magic_token_key" ON "portal_sessions"("magic_token");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_session_token_key" ON "portal_sessions"("session_token");

-- CreateIndex
CREATE INDEX "portal_sessions_contact_id_idx" ON "portal_sessions"("contact_id");

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
